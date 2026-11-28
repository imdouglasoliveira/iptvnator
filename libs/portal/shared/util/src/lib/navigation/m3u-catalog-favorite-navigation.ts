import type { PortalFavoriteItem } from '@iptvnator/shared/interfaces';
import type { UnifiedCollectionItem } from '../collection/unified-collection-item.interface';
import type { WorkspaceNavigationTarget } from './workspace-portal-navigation';

function section(
    playlistId: string,
    ...path: string[]
): WorkspaceNavigationTarget {
    return { link: ['/workspace', 'playlists', playlistId, ...path] };
}

/** A favorite series opens its own page; a movie with no saved URL has no page to open. */
export function m3uCatalogFavoriteTarget(
    item: UnifiedCollectionItem
): WorkspaceNavigationTarget | null {
    return item.contentType === 'series' && item.m3uCatalogId != null
        ? section(item.playlistId, 'series', String(item.m3uCatalogId))
        : null;
}

/** Dashboard rail rows of an M3U playlist's series and movies; live rows keep the collection route. */
export function m3uCatalogDashboardTarget(
    item: PortalFavoriteItem
): WorkspaceNavigationTarget | null {
    if (item.source !== 'm3u' || item.type === 'live') return null;
    return item.type === 'series'
        ? section(item.playlist_id, 'series', String(item.xtream_id))
        : section(item.playlist_id, 'vod');
}
