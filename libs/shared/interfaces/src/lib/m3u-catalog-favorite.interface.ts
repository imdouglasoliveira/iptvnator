/** `app_state` keys that record the one-time copy of favorite movies from the playlist JSON. */
export const M3U_CATALOG_FAVORITES_MARK_PREFIX = 'm3u-catalog-favorites-v1:';

export function m3uCatalogFavoritesMarkKey(playlistId: string): string {
    return `${M3U_CATALOG_FAVORITES_MARK_PREFIX}${playlistId}`;
}

export type M3uCatalogFavoriteType = 'movie' | 'series';

/** A series or movie of an M3U catalog saved in the `favorites` table. */
export interface M3uCatalogFavoriteInput {
    playlistId: string;
    type: M3uCatalogFavoriteType;
    stableId: number;
    title: string;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    /** Movie only: the entry URL kept in `playlists.favorites` next to the row. */
    url?: string | null;
}

export type M3uCatalogFavoriteSetRequest = M3uCatalogFavoriteInput & {
    favorite: boolean;
};

export interface M3uCatalogFavoriteSetResult {
    favoriteId: number | null;
}

export interface M3uCatalogFavoriteIdsRequest {
    playlistId: string;
    type: M3uCatalogFavoriteType;
}
