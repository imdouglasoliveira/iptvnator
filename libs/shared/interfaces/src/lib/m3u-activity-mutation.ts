import type {
    M3uRecentlyViewedItem,
    PlaylistRecentIdentity,
    PlaylistRecentlyViewedItem,
} from './playlist-recently-viewed.interface';

/** Set to `1` to send M3U history writes through the whole-document path. */
export const M3U_ACTIVITY_PARTIAL_WRITE_KILL_SWITCH_ENV =
    'IPTVNATOR_DISABLE_M3U_ACTIVITY_PARTIAL_WRITE';

/** Explicit history commands; no callback ever crosses IPC. */
export type M3uHistoryCommand =
    | { kind: 'history.touch'; item: M3uRecentlyViewedItem }
    | { kind: 'history.remove'; identities: PlaylistRecentIdentity[] }
    | { kind: 'history.clear' };

/** Explicit favorites commands, applied to the favorites stored at write time. */
export type M3uFavoritesCommand =
    | { kind: 'favorites.setMembership'; url: string; present: boolean }
    | { kind: 'favorites.reorder'; channelIds: string[] };

export type M3uActivityCommand = M3uHistoryCommand | M3uFavoritesCommand;

export interface M3uActivityMutationRequest {
    playlistId: string;
    command: M3uActivityCommand;
}

/** Only the changed activity comes back; `unavailable` means use the document path. */
export type M3uActivityMutationResult =
    | {
          status: 'applied';
          recentlyViewed?: PlaylistRecentlyViewedItem[];
          favorites?: string[];
      }
    | {
          status: 'unavailable';
          reason: 'disabled' | 'missing' | 'not-m3u' | 'unreadable';
      };

export const M3U_ACTIVITY_COMMAND_KINDS: ReadonlySet<string> = new Set([
    'history.touch',
    'history.remove',
    'history.clear',
    'favorites.setMembership',
    'favorites.reorder',
]);
