import type Database from 'better-sqlite3';
import { M3U_CATALOG_SNAPSHOT_KILL_SWITCH } from '@iptvnator/shared/interfaces/ipc-commands';

const items = (row: 'OLD' | 'NEW') =>
    `CASE WHEN json_valid(${row}.payload) THEN json_extract(${row}.payload, '$.playlist.items') END`;

// A database-wide sequence prevents reuse when a source is deleted and reimported.
const assignRevision = `
    INSERT INTO app_state (key, value) VALUES ('m3u-items-revision', '1')
    ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + 1;
    UPDATE playlists SET items_revision = (
        SELECT CAST(value AS INTEGER) FROM app_state WHERE key = 'm3u-items-revision'
    ) WHERE id = NEW.id;
`;

export const M3U_ITEMS_REVISION_TRIGGERS = [
    `
        CREATE TRIGGER IF NOT EXISTS m3u_items_revision_insert
        AFTER INSERT ON playlists
        WHEN NEW.type LIKE 'm3u-%' AND NEW.payload IS NOT NULL
        BEGIN
            ${assignRevision}
        END;
    `,
    `
        CREATE TRIGGER IF NOT EXISTS m3u_items_revision_update
        AFTER UPDATE OF payload, type ON playlists
        WHEN CASE WHEN NEW.type LIKE 'm3u-%' THEN
            OLD.type NOT LIKE 'm3u-%' OR (${items('OLD')}) IS NOT (${items('NEW')})
        ELSE 0 END
        BEGIN
            ${assignRevision}
        END;
    `,
];

export function ensureM3uItemsRevisionTriggers(db: Database.Database): void {
    if (process.env[M3U_CATALOG_SNAPSHOT_KILL_SWITCH] === '1') {
        db.transaction(() => {
            db.exec(`DROP TRIGGER IF EXISTS m3u_items_revision_insert`);
            db.exec(`DROP TRIGGER IF EXISTS m3u_items_revision_update`);
            // Writes during rollback have no item revision, so retire every cached snapshot.
            db.exec(`DELETE FROM m3u_catalog_snapshots`);
        }).immediate();
        return;
    }
    for (const statement of M3U_ITEMS_REVISION_TRIGGERS) db.exec(statement);
}
