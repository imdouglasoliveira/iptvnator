import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    catalogFavoritesPrelude,
    runCatalogFavoritesScript,
} from './testing/m3u-catalog-favorites-run';

interface Row {
    type: string;
    stableId: number;
    contentId: number | null;
    title: string;
}

interface Output {
    columnsAfterMigration: string[];
    legacyRows: Row[];
    seriesId: number | null;
    afterReopen: { m3u: Row[]; legacy: Row[]; json: string[] };
    afterDurableCheck: Row[];
    withMark: { first: number; second: number; rows: number };
    control: { first: number; again: number; rows: number };
    global: { type: string; playlistType: string; contentId: number | null }[];
}

const script = (dbFile: string) => `
    ${catalogFavoritesPrelude()}
    const file = ${JSON.stringify(dbFile)};
    const first = openDatabase(file);
    first.exec(\`CREATE TABLE favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
        playlist_id TEXT REFERENCES playlists(id),
        added_at TEXT, position INTEGER)\`);
    hooks.createTables(first);
    first.exec(\`
        INSERT INTO playlists (id, name, type) VALUES ('panel', 'Panel', 'xtream');
        INSERT INTO categories (id, playlist_id, xtream_id, name, type) VALUES (1, 'panel', 1, 'Movies', 'movies');
        INSERT INTO content (id, category_id, xtream_id, title, type) VALUES (1, 1, 7, 'Old Film', 'movie');
        INSERT INTO favorites (id, content_id, playlist_id, added_at, position) VALUES (5, 1, 'panel', '2025-01-01', 3);
    \`);
    hooks.runMigrations(first);
    const out = {};
    out.columnsAfterMigration = first.prepare("PRAGMA table_info('favorites')").all().map((c) => c.name);
    out.legacyRows = favoriteRows(first, 'panel');
    insertM3u(first, 'm3u', []);
    const db = drizzle(first, { schema });
    out.seriesId = ops.setM3uCatalogFavorite(db, { playlistId: 'm3u', type: 'series', stableId: 31, title: 'Show 31', favorite: true }).favoriteId;
    first.close();

    const second = openDatabase(file);
    hooks.createTables(second);
    hooks.runMigrations(second);
    out.afterReopen = { m3u: favoriteRows(second, 'm3u'), legacy: favoriteRows(second, 'panel'), json: jsonFavorites(second, 'm3u') };
    favoritesTable.ensureDurableFavorites(second);
    out.afterDurableCheck = favoriteRows(second, 'm3u');

    const db2 = drizzle(second, { schema });
    insertM3u(second, 'marked', [movieUrl(101, 'a'), movieUrl(102, 'a')]);
    const firstCopy = ops.copyM3uCatalogFavoritesFromJson(db2, 'marked').copied;
    const secondCopy = ops.copyM3uCatalogFavoritesFromJson(db2, 'marked').copied;
    out.withMark = { first: firstCopy, second: secondCopy, rows: favoriteRows(second, 'marked').length };

    insertM3u(second, 'control', [movieUrl(101, 'a'), movieUrl(102, 'a')]);
    const controlFirst = ops.copyM3uCatalogFavoritesFromJson(db2, 'control').copied;
    second.prepare("DELETE FROM favorites WHERE playlist_id = 'control'").run();
    second.prepare('DELETE FROM app_state WHERE key = ?').run('m3u-catalog-favorites-v1:control');
    const controlAgain = ops.copyM3uCatalogFavoritesFromJson(db2, 'control').copied;
    out.control = { first: controlFirst, again: controlAgain, rows: favoriteRows(second, 'control').length };

    const global = await favoritesOps.getAllGlobalFavorites(db2);
    out.global = global.map((row) => ({ type: row.type, playlistType: row.playlist_type, contentId: row.id }));
    console.log(JSON.stringify(out));
    second.close();
`;

describe('M3U catalog favorites on a migrated database', () => {
    let out: Output;
    let dataDir: string;

    beforeAll(() => {
        dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-m3u-favorites-'));
        out = runCatalogFavoritesScript<Output>(
            script(join(dataDir, 'app.sqlite'))
        );
    }, 60_000);

    afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

    it('migrates the historical favorites table before the M3U rows exist', () => {
        expect(out.columnsAfterMigration).toEqual(
            expect.arrayContaining(['xtream_id', 'type', 'title'])
        );
        expect(out.legacyRows).toEqual([
            {
                type: 'movie',
                stableId: 7,
                contentId: 1,
                title: 'Old Film',
                poster: null,
            },
        ]);
    });

    it('keeps the M3U row with a NULL content id across ensureDurableFavorites and a reopen', () => {
        expect(out.seriesId).toEqual(expect.any(Number));
        expect(out.afterReopen.m3u).toEqual([
            expect.objectContaining({
                type: 'series',
                stableId: 31,
                contentId: null,
                title: 'Show 31',
            }),
        ]);
        expect(out.afterReopen.json).toEqual(['m3u-series:31']);
        expect(out.afterReopen.legacy).toEqual(out.legacyRows);
        expect(out.afterDurableCheck).toEqual(out.afterReopen.m3u);
    });

    it('copies the JSON movies once and keeps the count on the second run', () => {
        expect(out.withMark).toEqual({ first: 2, second: 0, rows: 2 });
    });

    it('copies again without the mark (control)', () => {
        expect(out.control).toEqual({ first: 2, again: 2, rows: 2 });
    });

    it('returns the owning playlist type with the global favorites', () => {
        const byType = (type: string) =>
            out.global.filter((row) => row.playlistType === type);

        expect(byType('xtream')).toEqual([
            { type: 'movie', playlistType: 'xtream', contentId: 1 },
        ]);
        expect(byType('m3u-text').length).toBeGreaterThanOrEqual(3);
        expect(byType('m3u-text').every((row) => row.contentId === null)).toBe(
            true
        );
    });
});
