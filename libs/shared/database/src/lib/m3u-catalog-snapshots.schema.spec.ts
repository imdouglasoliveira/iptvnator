import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { M3U_CATALOG_SNAPSHOT_KILL_SWITCH } from '@iptvnator/shared/interfaces/ipc-commands';
import { __databaseConnectionTestHooks as hooks } from './connection';
import { openNodeSqlite } from './testing/node-sqlite-connection';

it.each(['fresh', 'v0.19.0'])(
    'creates the M3U snapshot schema on %s and preserves data on upgrade',
    (version) => {
        const sqlite = openNodeSqlite(':memory:');
        try {
            if (version !== 'fresh') {
                sqlite.exec(
                    readFileSync(
                        join(
                            __dirname,
                            'testing/fixtures',
                            `${version}-schema.sql`
                        ),
                        'utf8'
                    )
                );
            } else {
                hooks.createTables(sqlite);
            }
            sqlite.exec(
                "INSERT INTO playlists (id, name, type) VALUES ('old', 'Synthetic', 'm3u-text')"
            );

            for (let attempt = 0; attempt < 2; attempt++) {
                hooks.createTables(sqlite);
                hooks.runMigrations(sqlite);
                expect(
                    sqlite.prepare('PRAGMA table_info(playlists)').all().at(-1)
                ).toMatchObject({ name: 'payload' });
                expect(
                    sqlite
                        .prepare(
                            'SELECT name, items_revision FROM playlists WHERE id = ?'
                        )
                        .get('old')
                ).toMatchObject({ name: 'Synthetic', items_revision: 0 });
                expect(
                    sqlite
                        .prepare('PRAGMA table_info(m3u_catalog_snapshots)')
                        .all()
                ).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ name: 'playlist_id', pk: 1 }),
                        ...[
                            'items_revision',
                            'classifier_version',
                            'favorites',
                            'data',
                            'updated_at',
                        ].map((name) => expect.objectContaining({ name })),
                    ])
                );
            }
        } finally {
            sqlite.close();
        }
    }
);

it('retires snapshots and suspends revision writes across repeated disabled startups', () => {
    const sqlite = openNodeSqlite(':memory:');
    const previous = process.env[M3U_CATALOG_SNAPSHOT_KILL_SWITCH];
    const previousPriority = process.env.IPTVNATOR_DISABLE_M3U_PRIORITY_OPEN;
    process.env.IPTVNATOR_DISABLE_M3U_PRIORITY_OPEN = '1';
    const start = (disabled: boolean) => {
        process.env[M3U_CATALOG_SNAPSHOT_KILL_SWITCH] = disabled ? '1' : '0';
        hooks.createTables(sqlite);
        hooks.runMigrations(sqlite);
    };
    const payload = (name: string) =>
        JSON.stringify({ playlist: { items: [{ name }] } });
    try {
        start(false);
        const insert = sqlite.prepare(
            "INSERT INTO playlists (id, name, type, payload) VALUES (?, 'Synthetic', 'm3u-text', ?)"
        );
        const update = sqlite.prepare(
            'UPDATE playlists SET payload = ? WHERE id = ?'
        );
        const read = sqlite.prepare(
            'SELECT payload, items_revision FROM playlists WHERE id = ?'
        );
        insert.run('existing', payload('First'));
        const initial = Number(read.get('existing')?.items_revision);
        expect(initial).toBeGreaterThan(0);
        sqlite.prepare(
            "INSERT INTO m3u_catalog_snapshots (playlist_id, items_revision, classifier_version, data, updated_at) VALUES ('existing', ?, 1, '{}', '2000-01-01')"
        ).run(initial);

        start(true);
        update.run(payload('Second'), 'existing');
        insert.run('during-rollback', payload('Third'));
        start(true);
        expect(
            sqlite.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name GLOB 'm3u_items_revision_*'"
            ).all()
        ).toEqual([]);
        expect(read.get('existing')).toEqual({
            payload: payload('Second'),
            items_revision: initial,
        });
        expect(read.get('during-rollback')?.items_revision).toBe(0);
        expect(
            sqlite.prepare('SELECT playlist_id FROM m3u_catalog_snapshots').all()
        ).toEqual([]);

        start(false);
        start(false);
        expect(read.get('existing')?.payload).toBe(payload('Second'));
        update.run(payload('Fourth'), 'existing');
        expect(Number(read.get('existing')?.items_revision)).toBeGreaterThan(
            initial
        );
    } finally {
        if (previous === undefined)
            delete process.env[M3U_CATALOG_SNAPSHOT_KILL_SWITCH];
        else process.env[M3U_CATALOG_SNAPSHOT_KILL_SWITCH] = previous;
        if (previousPriority === undefined)
            delete process.env.IPTVNATOR_DISABLE_M3U_PRIORITY_OPEN;
        else process.env.IPTVNATOR_DISABLE_M3U_PRIORITY_OPEN = previousPriority;
        sqlite.close();
    }
});
