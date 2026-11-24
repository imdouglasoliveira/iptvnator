import {
    isM3uRecentlyViewedItem,
    type M3uActivityCommand,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import type { HistoryPlaylistAction } from '../history-events';
import type { PlaylistDocumentStore } from './playlist-storage-backend';

type ActivityStore = Pick<PlaylistDocumentStore, 'dbMutateM3uActivity'>;

function toCommand(action: HistoryPlaylistAction): M3uActivityCommand | null {
    switch (action.kind) {
        case 'touch':
            return isM3uRecentlyViewedItem(action.item)
                ? { kind: 'history.touch', item: action.item }
                : null;
        case 'remove':
            return {
                kind: 'history.remove',
                identities: action.identities,
            };
        case 'clear':
            return { kind: 'history.clear' };
    }
}

// Resolves null when the whole-document path must run (no bridge, kill switch, non-M3U).
export async function tryPartialHistoryMutation(
    store: ActivityStore | null | undefined,
    playlistId: string,
    action: HistoryPlaylistAction
): Promise<Playlist | null> {
    const mutate = store?.dbMutateM3uActivity;
    const command = toCommand(action);
    if (!mutate || !command) return null;
    const result = await mutate.call(store, { playlistId, command });
    if (result.status !== 'applied') return null;
    return {
        _id: playlistId,
        recentlyViewed: result.recentlyViewed ?? [],
    } as Playlist;
}

export type FavoritesIntent = Extract<
    M3uActivityCommand,
    { kind: `favorites.${string}` }
>;

// Resolves null when the whole-document path must run (no bridge, kill switch, non-M3U).
export async function tryPartialFavoritesMutation(
    store: ActivityStore | null | undefined,
    playlistId: string,
    command: FavoritesIntent
): Promise<Playlist | null> {
    const mutate = store?.dbMutateM3uActivity;
    if (!mutate) return null;
    const result = await mutate.call(store, { playlistId, command });
    if (result.status !== 'applied' || !result.favorites) return null;
    return { _id: playlistId, favorites: result.favorites } as Playlist;
}
