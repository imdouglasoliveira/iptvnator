import { CollectionContentType } from '../collection/unified-collection-item.interface';

/**
 * Where an M3U row of a collection opens, by what the row is. Films and
 * series stay in their own section, as an Xtream item does; only a live row
 * belongs to the playlist's full list.
 */
export function buildM3uCollectionLink(
    playlistId: string,
    contentType: CollectionContentType
): string[] {
    const root = ['/workspace', 'playlists', playlistId];
    if (contentType === 'movie') {
        return [...root, 'vod', 'play'];
    }
    return [...root, contentType === 'series' ? 'series' : 'all'];
}
