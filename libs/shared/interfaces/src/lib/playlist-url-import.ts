import type { ElectronBridgePlaylistFetchOptions } from './electron-api.interface';
import type { Playlist } from './playlist.interface';
import type { PlaylistMeta } from './playlist-meta.type';

/**
 * Kill switch for the main-process URL import (remove within two releases).
 * `IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT=1` returns the parsed playlist to the
 * renderer, which then persists it through the previous path.
 */
export const MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV =
    'IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT';

export interface PlaylistUrlImportOptions
    extends ElectronBridgePlaylistFetchOptions {
    /** Trimmed title chosen in the dialog; sets both title and filename. */
    title?: string;
    /** Dialog EPG choice; `false` applies the opt-out before persisting. */
    autoImportEpg?: boolean;
}

export type PlaylistUrlImportResult =
    | { readonly persisted: true; readonly playlist: PlaylistMeta }
    | { readonly persisted: false; readonly playlist: Playlist };
