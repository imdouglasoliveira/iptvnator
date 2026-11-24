import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real migrated SQLite in Electron's Node, as the other *.sqlite.spec files.
function run(killSwitch: boolean) {
    const operations = pathToFileURL(
        resolve(__dirname, 'm3u-activity.operations.ts')
    ).href;
    const playlistOperations = pathToFileURL(
        resolve(__dirname, 'playlist.operations.ts')
    ).href;
    const connection = pathToFileURL(
        resolve(process.cwd(), 'libs/shared/database/src/lib/connection.ts')
    ).href;
    const script = `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const schema = await import('@iptvnator/shared/database/schema');
        const { buildPlaylistRow, parseAppPlaylist } = await import(${JSON.stringify(playlistOperations)});
        const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(connection)});
        const { mutateM3uActivity, upsertAppPlaylistKeepingActivity } = await import(${JSON.stringify(operations)});
        const sqlite = new Database(':memory:');
        sqlite.pragma('foreign_keys = ON');
        hooks.createTables(sqlite);
        hooks.runMigrations(sqlite);
        const db = drizzle(sqlite, { schema });
        const base = 'http://catalog.example.test/';
        const items = Array.from({ length: 2000 }, (_, i) => ({ url: base + i, name: 'Channel ' + i }));
        const m3u = {
            _id: 'm3u', title: 'Synthetic', type: 'm3u-text', count: items.length,
            importDate: '2026-01-01T00:00:00.000Z', autoRefresh: false, playlist: { items },
            recentlyViewed: [{ source: 'm3u', id: base + '1', url: base + '1', title: 'One', category_id: 'live', added_at: '2026-01-01T00:00:00.000Z', poster_url: 'http://logo.example.test/1.png' }],
        };
        for (const [id, type] of [['m3u', 'm3u-text'], ['xtream', 'xtream']]) {
            const row = buildPlaylistRow({ ...m3u, _id: id, type });
            sqlite.prepare('INSERT INTO playlists (id, name, type, payload, recently_viewed) VALUES (?, ?, ?, ?, ?)').run(id, 'Synthetic', type, row.payload, row.recentlyViewed);
        }
        const payloadOf = (id) => sqlite.prepare('SELECT payload FROM playlists WHERE id = ?').get(id).payload;
        const readDoc = (id) => parseAppPlaylist(db.select().from(schema.playlists).all().find((row) => row.id === id));
        const initialPayload = payloadOf('m3u');
        const item = (n, extra = {}) => ({ source: 'm3u', id: base + n, url: base + n, title: 'T' + n, category_id: 'live', added_at: 'ignored', ...extra });
        const out = {};
        out.touchNew = mutateM3uActivity(db, { playlistId: 'm3u', command: { kind: 'history.touch', item: item(2) } });
        out.touchExisting = mutateM3uActivity(db, { playlistId: 'm3u', command: { kind: 'history.touch', item: item(1, { title: 'Renamed' }) } });
        out.payloadUntouched = payloadOf('m3u') === initialPayload;
        const stale = JSON.parse(initialPayload);
        stale.playlist = { items: items.slice(0, 5) };
        upsertAppPlaylistKeepingActivity(db, stale);
        out.afterRefresh = readDoc('m3u').recentlyViewed.map((i) => i.url);
        out.refreshItems = readDoc('m3u').playlist.items.length;
        out.removeUrl = mutateM3uActivity(db, { playlistId: 'm3u', command: { kind: 'history.remove', identities: [base + '2'] } });
        out.removeObject = mutateM3uActivity(db, { playlistId: 'm3u', command: { kind: 'history.remove', identities: [item(1)] } });
        out.clear = mutateM3uActivity(db, { playlistId: 'm3u', command: { kind: 'history.clear' } });
        out.notM3u = mutateM3uActivity(db, { playlistId: 'xtream', command: { kind: 'history.clear' } });
        out.missing = mutateM3uActivity(db, { playlistId: 'nope', command: { kind: 'history.clear' } });
        out.invalid = mutateM3uActivity(db, { playlistId: 'm3u', command: { kind: 'history.touch', item: { url: '' } } });
        out.xtreamHistoryKept = readDoc('xtream').recentlyViewed.length;
        console.log(JSON.stringify(out));
        sqlite.close();
    `;
    return JSON.parse(
        execFileSync(
            createRequire(__filename)('electron'),
            ['--import', 'tsx', '--eval', script],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    TSX_TSCONFIG_PATH: resolve(
                        process.cwd(),
                        'tsconfig.base.json'
                    ),
                    ...(killSwitch
                        ? { IPTVNATOR_DISABLE_M3U_ACTIVITY_PARTIAL_WRITE: '1' }
                        : {}),
                },
            }
        )
    );
}

const base = 'http://catalog.example.test/';
const urls = (result: { recentlyViewed: { url: string }[] }) =>
    result.recentlyViewed.map((item) => item.url);

describe('M3U activity partial write on SQLite', () => {
    it('updates history without touching the catalog payload', () => {
        const out = run(false);

        expect(urls(out.touchNew)).toEqual([base + '2', base + '1']);
        expect(urls(out.touchExisting)).toEqual([base + '1', base + '2']);
        expect(out.touchExisting.recentlyViewed[0]).toEqual(
            expect.objectContaining({
                title: 'Renamed',
                poster_url: 'http://logo.example.test/1.png',
            })
        );
        expect(out.touchExisting.recentlyViewed[0].added_at).not.toBe(
            'ignored'
        );
        expect(out.payloadUntouched).toBe(true);
        expect(urls(out.removeUrl)).toEqual([base + '1']);
        expect(out.removeObject.recentlyViewed).toEqual([]);
        expect(out.clear).toEqual({ status: 'applied', recentlyViewed: [] });
    });

    it('keeps the stored history when a stale refresh snapshot is upserted', () => {
        const out = run(false);

        expect(out.afterRefresh).toEqual([base + '1', base + '2']);
        expect(out.refreshItems).toBe(5);
    });

    it('declines what it cannot do and leaves the row alone', () => {
        const out = run(false);

        expect(out.notM3u).toEqual({
            status: 'unavailable',
            reason: 'not-m3u',
        });
        expect(out.missing).toEqual({
            status: 'unavailable',
            reason: 'missing',
        });
        expect(out.invalid).toEqual({
            status: 'unavailable',
            reason: 'unreadable',
        });
        expect(out.xtreamHistoryKept).toBe(1);
    });

    it('declines every command and lets a refresh replace history under the kill switch', () => {
        const out = run(true);

        expect(out.touchNew).toEqual({
            status: 'unavailable',
            reason: 'disabled',
        });
        expect(out.afterRefresh).toEqual([base + '1']);
    });
});
