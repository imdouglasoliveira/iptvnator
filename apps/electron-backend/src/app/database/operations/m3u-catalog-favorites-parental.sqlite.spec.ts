import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    catalogFavoritesPrelude,
    runCatalogFavoritesScript,
} from './testing/m3u-catalog-favorites-run';

interface Output {
    unlocked: string[];
    locked: string[];
}

const script = (dbFile: string) => `
    ${catalogFavoritesPrelude()}
    const parental = await import(${JSON.stringify(
        pathToFileURL(join(__dirname, '..', 'parental-lock-state.ts')).href
    )});
    const sqlite = openDatabase(${JSON.stringify(dbFile)});
    hooks.createTables(sqlite);
    hooks.runMigrations(sqlite);
    sqlite.exec(\`
        INSERT INTO playlists (id, name, type) VALUES ('panel', 'Panel', 'xtream');
        INSERT INTO categories (id, playlist_id, xtream_id, name, type, locked) VALUES (1, 'panel', 1, 'Adults', 'movies', 1);
        INSERT INTO content (id, category_id, xtream_id, title, type) VALUES (1, 1, 7, 'Held Film', 'movie');
    \`);
    sqlite.prepare("INSERT INTO favorites (content_id, playlist_id, xtream_id, type, title) VALUES (1, 'panel', 7, 'movie', 'Held Film')").run();
    insertM3u(sqlite, 'list', []);
    const db = drizzle(sqlite, { schema });
    ops.setM3uCatalogFavorite(db, { playlistId: 'list', type: 'series', stableId: 31, title: 'Show 31', favorite: true });
    const titles = async () => (await favoritesOps.getAllGlobalFavorites(db)).map((row) => row.title).sort();
    const out = { unlocked: await titles() };
    parental.setParentalLockActive(true);
    out.locked = await titles();
    console.log(JSON.stringify(out));
    sqlite.close();
`;

describe('M3U catalog favorites under the parental lock', () => {
    let out: Output;
    let dataDir: string;

    beforeAll(() => {
        dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-m3u-lock-'));
        out = runCatalogFavoritesScript<Output>(
            script(join(dataDir, 'app.sqlite'))
        );
    }, 60_000);

    afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

    it('lists both rows while unlocked (control)', () => {
        expect(out.unlocked).toEqual(['Held Film', 'Show 31']);
    });

    it('withholds the locked portal row and keeps the M3U row for the renderer to filter by group', () => {
        expect(out.locked).toEqual(['Show 31']);
    });
});
