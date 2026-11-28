import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const operationsDir = resolve(__dirname, '..');
const href = (path: string) => JSON.stringify(pathToFileURL(path).href);

// Imports and synthetic M3U fixture helpers for a script run in Electron's Node.
export function catalogFavoritesPrelude(): string {
    return `
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        const schema = await import('@iptvnator/shared/database/schema');
        const playlistOps = await import(${href(resolve(operationsDir, 'playlist.operations.ts'))});
        const { __databaseConnectionTestHooks: hooks } = await import(${href(resolve(process.cwd(), 'libs/shared/database/src/lib/connection.ts'))});
        const ops = await import(${href(resolve(operationsDir, 'm3u-catalog-favorites.operations.ts'))});
        const favoritesTable = await import(${href(resolve(process.cwd(), 'libs/shared/database/src/lib/favorites-table.ts'))});
        const favoritesOps = await import(${href(resolve(operationsDir, 'favorites.operations.ts'))});
        const openDatabase = (file) => {
            const sqlite = new Database(file ?? ':memory:');
            sqlite.pragma('foreign_keys = ON');
            return sqlite;
        };
        const base = 'http://media.example.test/';
        const movieUrl = (id, token) => base + 'movie/u/p/' + id + '.mp4' + (token ? '?token=' + token : '');
        const entry = (id, url, name, logo) => ({
            id, url, name, group: { title: 'Synthetic' },
            tvg: { id: '', name: '', url: '', logo: logo ?? '', rec: '' },
            http: { referrer: '', 'user-agent': '', origin: '' }, radio: 'false',
        });
        const items = [
            entry('m101', movieUrl(101, 'a'), 'Film One', 'http://img.example.test/101.jpg'),
            entry('m102', movieUrl(102, 'a'), 'Film Two', ''),
            entry('m101hd', base + 'movie/u/p/101.mkv', 'Film One HD', ''),
            { ...entry('c9', base + 'live/u/p/9.ts', 'Channel Nine', ''), tvg: { id: 'nine', name: '', url: '', logo: '', rec: '' } },
            entry('e55', base + 'series/u/p/55.mp4', 'Show S01E01', ''),
        ];
        const insertM3u = (sqlite, id, favorites, withPayload = true) => {
            const row = playlistOps.buildPlaylistRow({
                _id: id, title: 'Synthetic ' + id, type: 'm3u-text', count: items.length,
                importDate: '2026-01-01T00:00:00.000Z', autoRefresh: false, playlist: { items },
            });
            sqlite.prepare('INSERT INTO playlists (id, name, type, payload, favorites) VALUES (?, ?, ?, ?, ?)')
                .run(id, 'Synthetic ' + id, 'm3u-text', withPayload ? row.payload : null, JSON.stringify(favorites));
        };
        const favoriteRows = (sqlite, playlistId) => sqlite
            .prepare('SELECT type, xtream_id AS stableId, content_id AS contentId, title, poster_url AS poster FROM favorites WHERE playlist_id = ? ORDER BY xtream_id')
            .all(playlistId);
        const jsonFavorites = (sqlite, id) => JSON.parse(sqlite.prepare('SELECT favorites FROM playlists WHERE id = ?').get(id).favorites);
        const markCount = (sqlite, id) => sqlite
            .prepare('SELECT COUNT(*) AS n FROM app_state WHERE key = ?').get('m3u-catalog-favorites-v1:' + id).n;
    `;
}

export function runCatalogFavoritesScript<T>(script: string): T {
    return JSON.parse(
        execFileSync(
            createRequire(__filename)('electron'),
            ['--import', 'tsx', '--eval', script],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
                timeout: 40_000,
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    TSX_TSCONFIG_PATH: resolve(
                        process.cwd(),
                        'tsconfig.base.json'
                    ),
                },
            }
        )
    ) as T;
}
