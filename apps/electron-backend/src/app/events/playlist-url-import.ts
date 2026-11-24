import {
    MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV,
    type Playlist,
    type PlaylistMeta,
    type PlaylistUrlImportOptions,
    type PlaylistUrlImportResult,
} from '@iptvnator/shared/interfaces';
import { applyPlaylistEpgImportPreference } from '@iptvnator/shared/m3u-utils';
import { getDatabase } from '../database/connection';
import { databaseWorkerClient } from '../services/database-worker-client';
import type { M3uImportPerformanceCapture } from './playlist-import-performance';
import { fetchPlaylistFromUrl } from './playlist-source';

export function isMainPlaylistImportEnabled(
    env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
    return env[MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV] !== '1';
}

/** The playlist without its parsed items: what the renderer keeps in memory. */
export function toImportedPlaylistMeta(playlist: Playlist): PlaylistMeta {
    const { playlist: parsedItems, ...meta } = playlist;
    void parsedItems;
    return meta;
}

/**
 * URL import for Electron. Large M3U exports cost minutes when the parsed
 * playlist is cloned to the renderer and back for the database write, so the
 * main process persists it and returns only the meta.
 */
export async function importPlaylistFromUrl(
    url: string,
    options: PlaylistUrlImportOptions = {},
    performanceCapture: M3uImportPerformanceCapture | null = null
): Promise<PlaylistUrlImportResult> {
    const title = options.title?.trim() || undefined;
    const fetched = await fetchPlaylistFromUrl(url, title, {
        performanceCapture,
        userAgent: options.userAgent,
        trustedInsecureTlsHosts: options.trustedInsecureTlsHosts,
    });
    const playlist = applyPlaylistEpgImportPreference(
        fetched,
        options.autoImportEpg
    );
    if (!isMainPlaylistImportEnabled()) {
        return { persisted: false, playlist };
    }
    await getDatabase();
    await databaseWorkerClient.request('DB_UPSERT_APP_PLAYLIST', playlist);
    return { persisted: true, playlist: toImportedPlaylistMeta(playlist) };
}
