import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { M3U_CATALOG_SNAPSHOT_KILL_SWITCH } from '@iptvnator/shared/interfaces/ipc-commands';
import { __databaseConnectionTestHooks as hooks } from '@iptvnator/shared/database';
import * as schema from '@iptvnator/shared/database/schema';
import { M3U_CLASSIFIER_VERSION } from '@iptvnator/shared/m3u-utils/catalog';
import { getM3uCatalogSnapshot } from '../m3u-catalog-snapshot.operations';
import { upsertAppPlaylistKeepingActivity } from '../m3u-activity.operations';
import { migrateAppPlaylists } from '../playlist-migration.operations';
import {
    getAppPlaylist,
    upsertAppPlaylist,
    upsertAppPlaylists,
} from '../playlist.operations';

async function verify() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    hooks.createTables(sqlite);
    hooks.runMigrations(sqlite);
    const db = drizzle(sqlite, { schema });
    const document = {
        _id: 'single',
        title: 'Synthetic',
        playlist: {
            items: [
                {
                    name: 'Synthetic TV',
                    url: 'https://example.test/channel.ts',
                },
                {
                    name: 'Synthetic Radio',
                    url: 'https://example.test/station',
                    radio: 'true',
                },
                {
                    name: 'Synthetic Film',
                    url: 'https://example.test/movie/1.mp4',
                },
            ],
        },
    };
    const read = (id: string) => getM3uCatalogSnapshot(db, id);
    const persisted = (id: string) =>
        sqlite
            .prepare(
                'SELECT data FROM m3u_catalog_snapshots WHERE playlist_id = ?'
            )
            .pluck()
            .get(id);
    const waitForSnapshot = async (id: string): Promise<string> => {
        for (let turn = 0; turn < 100; turn++) {
            const data = persisted(id);
            if (typeof data === 'string' && read(id) === data) return data;
            await nextTurn();
        }
        throw new Error('Snapshot did not persist');
    };

    try {
        await upsertAppPlaylist(db, document);
        assert.equal(persisted('single'), undefined);
        upsertAppPlaylistKeepingActivity(db, { ...document, _id: 'refresh' });
        await upsertAppPlaylists(db, [{ ...document, _id: 'bulk' }]);
        migrateAppPlaylists(db, [{ ...document, _id: 'legacy' }]);

        for (const id of ['single', 'refresh', 'bulk', 'legacy']) {
            const snapshot = JSON.parse(await waitForSnapshot(id));
            const saved = await getAppPlaylist(db, id);
            assert.equal(snapshot.itemsRevision, saved?.['itemsRevision']);
            assert.equal(snapshot.classifierVersion, M3U_CLASSIFIER_VERSION);
            assert.equal(snapshot.kinds, 'lrm');
            assert.deepEqual(snapshot.counts, {
                live: 1,
                movie: 1,
                episode: 0,
                radio: 1,
            });
        }

        const original = await waitForSnapshot('single');
        await upsertAppPlaylist(db, { ...document, title: 'Renamed' });
        assert.equal(read('single'), original);

        sqlite
            .prepare(
                'UPDATE m3u_catalog_snapshots SET classifier_version = 0 WHERE playlist_id = ?'
            )
            .run('single');
        assert.equal(read('single'), null);
        assert.equal(await waitForSnapshot('single'), original);

        await upsertAppPlaylist(db, {
            ...document,
            playlist: { items: [...document.playlist.items].reverse() },
        });
        assert.equal(read('single'), null);
        const updated = JSON.parse(await waitForSnapshot('single'));
        assert.equal(updated.kinds, 'mrl');
        assert.ok(updated.itemsRevision > JSON.parse(original).itemsRevision);

        sqlite.prepare('DELETE FROM playlists WHERE id = ?').run('single');
        assert.equal(persisted('single'), undefined);
        assert.equal(read('single'), null);
        await upsertAppPlaylist(db, document);
        const restored = JSON.parse(await waitForSnapshot('single'));
        assert.ok(restored.itemsRevision > updated.itemsRevision);
        assert.equal(restored.kinds, 'lrm');

        sqlite.prepare(
            "INSERT INTO playlists (id, name, type, payload) VALUES ('cold', 'Synthetic', 'm3u-text', ?)"
        ).run(JSON.stringify({ ...document, padding: 'x'.repeat(512 * 1024) }));
        assert.equal(read('cold'), null);
        for (let turn = 0; turn < 3; turn++) await nextTurn();
        assert.equal(persisted('cold'), undefined);
        assert.equal(JSON.parse(await waitForSnapshot('cold')).kinds, 'lrm');

        const transactions: string[] = [];
        const transaction = db.transaction.bind(db);
        db.transaction = (run, config) => {
            transactions.push(config?.behavior ?? 'deferred');
            return transaction(run, config);
        };
        process.env[M3U_CATALOG_SNAPSHOT_KILL_SWITCH] = '1';
        hooks.runMigrations(sqlite);
        upsertAppPlaylistKeepingActivity(db, {
            ...document,
            playlist: { items: [document.playlist.items[2]] },
        });
        assert.deepEqual(transactions, []);
        await upsertAppPlaylists(db, [{ ...document, _id: 'bulk-disabled' }]);
        migrateAppPlaylists(
            db,
            [{ ...document, _id: 'legacy-disabled' }],
            'synthetic-migration'
        );
        assert.deepEqual(transactions, ['deferred', 'deferred']);
        assert.equal(read('single'), null);

        process.env[M3U_CATALOG_SNAPSHOT_KILL_SWITCH] = '0';
        hooks.runMigrations(sqlite);
        assert.equal(read('single'), null);
        assert.equal(JSON.parse(await waitForSnapshot('single')).kinds, 'm');
    } finally {
        sqlite.close();
    }
}

void verify().then(() => process.stdout.write('snapshots verified'));
