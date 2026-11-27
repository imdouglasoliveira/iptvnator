/**
 * Migration statements that may fail if already applied
 * These are run with try-catch to handle existing columns
 */
export const COLUMN_MIGRATION_STATEMENTS = [
    // v1.0.0 -> v1.1.0: Add hidden column to categories for category management
    `ALTER TABLE categories ADD COLUMN hidden INTEGER DEFAULT 0`,
    // Parental lock: per-category lock index (issue #285)
    `ALTER TABLE categories ADD COLUMN locked INTEGER DEFAULT 0`,
    `ALTER TABLE categories ADD COLUMN provider_order INTEGER`,
    // v1.1.0 -> v1.2.0: Add playlist metadata/payload columns for M3U + unified playlist persistence
    `ALTER TABLE playlists ADD COLUMN portal_url TEXT`,
    `ALTER TABLE playlists ADD COLUMN count INTEGER`,
    `ALTER TABLE playlists ADD COLUMN import_date TEXT`,
    `ALTER TABLE playlists ADD COLUMN update_date INTEGER`,
    `ALTER TABLE playlists ADD COLUMN position INTEGER`,
    `ALTER TABLE playlists ADD COLUMN favorites TEXT`,
    `ALTER TABLE playlists ADD COLUMN recently_viewed TEXT`,
    `ALTER TABLE playlists ADD COLUMN payload TEXT`,
    `ALTER TABLE playlists ADD COLUMN items_revision INTEGER NOT NULL DEFAULT 0`,
    // v1.2.1: Keep M3U-detected EPG URLs available in lightweight playlist metadata
    `ALTER TABLE playlists ADD COLUMN epg_urls TEXT`,
    `ALTER TABLE playlists ADD COLUMN detected_epg_urls TEXT`,
    `ALTER TABLE playlists ADD COLUMN manual_epg_urls TEXT`,
    `ALTER TABLE playlists ADD COLUMN disabled_epg_urls TEXT`,
    // Nullable: older sources keep default-on without rewriting their data.
    `ALTER TABLE playlists ADD COLUMN auto_import_epg INTEGER`,
    // v1.2.0 -> v1.3.0: Add position column to favorites for global favorites ordering
    `ALTER TABLE favorites ADD COLUMN position INTEGER DEFAULT 0`,
    `ALTER TABLE favorites ADD COLUMN identity_conflict INTEGER NOT NULL DEFAULT 0`,
    // v1.4.0 -> v1.5.0: Preserve Xtream live metadata required for EPG/catch-up
    `ALTER TABLE content ADD COLUMN epg_channel_id TEXT`,
    `ALTER TABLE content ADD COLUMN tv_archive INTEGER`,
    `ALTER TABLE content ADD COLUMN tv_archive_duration INTEGER`,
    `ALTER TABLE content ADD COLUMN direct_source TEXT`,
    // v1.5.0 -> v1.6.0: Cinematic backdrop persisted on first detail fetch
    `ALTER TABLE content ADD COLUMN backdrop_url TEXT`,
    // Identity resolved by a detail view, so activity rows can repeat that
    // lookup instead of rebuilding a weaker one from the display title
    `ALTER TABLE content ADD COLUMN tmdb_id INTEGER`,
    `ALTER TABLE content ADD COLUMN release_year INTEGER`,
    `ALTER TABLE content ADD COLUMN original_title TEXT`,
    // v1.7.1: Scope XMLTV programs to their source URL for playlist-local EPG lookup
    `ALTER TABLE epg_programs ADD COLUMN source_url TEXT`,
    // Preserve writer order independently of wall-clock precision or changes.
    `ALTER TABLE epg_channel_sources ADD COLUMN write_order INTEGER NOT NULL DEFAULT 0`,
    // Pause/resume: entity validator (ETag/Last-Modified) sent as If-Range on resume
    `ALTER TABLE downloads ADD COLUMN resume_validator TEXT`,
    // Offline details: provider-neutral display metadata captured at download time
    `ALTER TABLE downloads ADD COLUMN metadata_snapshot TEXT`,
    // Series queue: scope coordinate compatibility across provider series modes
    `ALTER TABLE downloads ADD COLUMN episode_identity_scope TEXT`,
];
