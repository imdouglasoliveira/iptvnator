import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { playlists } from './schema';

export const m3uCatalogSnapshots = sqliteTable('m3u_catalog_snapshots', {
    playlistId: text('playlist_id')
        .primaryKey()
        .notNull()
        .references(() => playlists.id, { onDelete: 'cascade' }),
    itemsRevision: integer('items_revision').notNull(),
    classifierVersion: integer('classifier_version').notNull(),
    favorites: text('favorites'),
    data: text('data').notNull(),
    updatedAt: text('updated_at').notNull(),
});

export const M3U_CATALOG_SNAPSHOTS_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS m3u_catalog_snapshots (
        playlist_id TEXT PRIMARY KEY NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        items_revision INTEGER NOT NULL,
        classifier_version INTEGER NOT NULL,
        favorites TEXT,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
`;
