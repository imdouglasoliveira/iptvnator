import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { __databaseConnectionTestHooks as hooks } from '@iptvnator/shared/database';
import * as schema from '@iptvnator/shared/database/schema';
import { getM3uFavoritesSnapshot } from '../m3u-favorites-snapshot.operations';
import { mutateM3uActivity, upsertAppPlaylistKeepingActivity } from '../m3u-activity.operations';
import { migrateAppPlaylists } from '../playlist-migration.operations';
import { upsertAppPlaylist, upsertAppPlaylists } from '../playlist.operations';

async function verify() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    hooks.createTables(sqlite);
    hooks.runMigrations(sqlite);
    const db = drizzle(sqlite, { schema });
    const channels = ['one', 'two', 'three', 'four'].map((id) => ({
        id, name: id, url: `https://example.test/${id}.ts`,
    }));
    const document = {
        _id: 'single',
        title: 'Synthetic',
        favorites: channels.slice(0, 3).map(({ url }) => url),
        playlist: { items: [channels[0], { ...channels[0], id: 'duplicate' }, ...channels.slice(1)] },
    };
    const read = (id = 'single') => getM3uFavoritesSnapshot(db, id);
    async function waitForSnapshot(id = 'single') {
        for (let turn = 0; turn < 100; turn++) {
            const snapshot = read(id);
            if (snapshot !== null) return JSON.parse(snapshot);
            await nextTurn();
        }
        throw new Error('Favorites snapshot did not persist');
    }

    try {
        await upsertAppPlaylist(db, document);
        upsertAppPlaylistKeepingActivity(db, { ...document, _id: 'refresh' });
        await upsertAppPlaylists(db, [{ ...document, _id: 'bulk' }]);
        migrateAppPlaylists(db, [{ ...document, _id: 'legacy' }]);
        for (const id of ['single', 'refresh', 'bulk', 'legacy']) {
            assert.deepEqual((await waitForSnapshot(id)).channels, channels.slice(0, 3));
        }

        const payload = () => sqlite.prepare('SELECT payload FROM playlists WHERE id = ?')
            .pluck().get('single');
        const savedPayload = payload();
        const result = mutateM3uActivity(db, {
            playlistId: 'single',
            command: { kind: 'favorites.setMembership', url: channels[3].url, present: true },
        });
        assert.equal(result.status, 'applied');
        assert.deepEqual(JSON.parse(read() ?? 'null')?.channels, channels);
        assert.equal(payload(), savedPayload);

        process.env.IPTVNATOR_DISABLE_M3U_PRIORITY_OPEN = '1';
        assert.equal(read(), null);
        process.env.IPTVNATOR_DISABLE_M3U_PRIORITY_OPEN = '0';

        upsertAppPlaylistKeepingActivity(db, {
            ...document,
            playlist: { items: channels.slice(1) },
        });
        assert.equal(read(), null);
        assert.deepEqual((await waitForSnapshot()).channels, channels.slice(1));

        sqlite.prepare('UPDATE m3u_catalog_snapshots SET classifier_version = 0').run();
        assert.equal(read(), null);
        await upsertAppPlaylist(db, { ...document, _id: 'metadata' });
        await waitForSnapshot('metadata');
        await upsertAppPlaylist(db, { ...document, _id: 'metadata', title: 'Renamed' });
        assert.deepEqual(JSON.parse(read('metadata') ?? 'null')?.channels, channels.slice(0, 3));
        await upsertAppPlaylist(db, {
            ...document,
            _id: 'metadata',
            favorites: [channels[3].url],
        });
        assert.equal(read('metadata'), null);
        assert.deepEqual((await waitForSnapshot('metadata')).channels, [channels[3]]);
    } finally {
        sqlite.close();
    }
}

void verify().then(() => process.stdout.write('favorites verified'));
