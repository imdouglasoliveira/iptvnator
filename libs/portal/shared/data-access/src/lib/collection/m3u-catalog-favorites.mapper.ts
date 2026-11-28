import {
    ELECTRON_BRIDGE_PLAYLIST_TYPES,
    normalizeStalkerDate,
    type ElectronBridgeFavoriteReorderUpdate,
} from '@iptvnator/shared/interfaces';
import { m3uMovieStableId } from '@iptvnator/shared/m3u-utils/catalog';
import {
    buildCollectionUid,
    type UnifiedCollectionItem,
    type XtreamFavoriteRow,
} from '@iptvnator/portal/shared/util';

const M3U_PLAYLIST_TYPES: readonly string[] = [
    ELECTRON_BRIDGE_PLAYLIST_TYPES.M3uFile,
    ELECTRON_BRIDGE_PLAYLIST_TYPES.M3uText,
    ELECTRON_BRIDGE_PLAYLIST_TYPES.M3uUrl,
];

export function isM3uPlaylistType(type: string | null | undefined): boolean {
    return !!type && M3U_PLAYLIST_TYPES.includes(type);
}

function isCatalogRow(row: XtreamFavoriteRow): boolean {
    return (
        isM3uPlaylistType(row.playlist_type) &&
        (row.type === 'movie' || row.type === 'series')
    );
}

/** Rows of an M3U playlist never reach the Xtream mapper or its API. */
export function splitFavoriteRowsByPlaylist(
    rows: readonly XtreamFavoriteRow[]
): {
    xtream: XtreamFavoriteRow[];
    m3u: XtreamFavoriteRow[];
} {
    const xtream: XtreamFavoriteRow[] = [];
    const m3u: XtreamFavoriteRow[] = [];
    for (const row of rows) {
        if (isCatalogRow(row)) m3u.push(row);
        else if (!isM3uPlaylistType(row.playlist_type)) xtream.push(row);
    }
    return { xtream, m3u };
}

export function mapM3uCatalogRow(
    row: XtreamFavoriteRow
): UnifiedCollectionItem {
    const contentType = row.type === 'series' ? 'series' : 'movie';
    return {
        uid: buildCollectionUid(
            'm3u',
            row.playlist_id,
            `catalog:${contentType}:${row.xtream_id}`
        ),
        name: row.title,
        contentType,
        sourceType: 'm3u',
        playlistId: row.playlist_id,
        playlistName: row.playlist_name ?? 'M3U',
        logo: null,
        posterUrl: row.poster_url ?? null,
        m3uCatalogId: row.xtream_id,
        favoriteId: row.favorite_id,
        addedAt:
            normalizeStalkerDate(row.added_at) || new Date(0).toISOString(),
        position: row.position ?? 0,
    };
}

/** The JSON entry of a favorite movie is the one that plays: it takes the row's identity and is listed once. */
export function mergeM3uCatalogFavorites(
    jsonItems: UnifiedCollectionItem[],
    rows: readonly XtreamFavoriteRow[]
): UnifiedCollectionItem[] {
    const catalog = rows.filter(isCatalogRow);
    if (catalog.length === 0) return jsonItems;

    const movies = new Map<string, XtreamFavoriteRow>();
    for (const row of catalog) {
        if (row.type === 'movie') {
            movies.set(`${row.playlist_id}|${row.xtream_id}`, row);
        }
    }
    const claimed = new Set<XtreamFavoriteRow>();
    const merged: UnifiedCollectionItem[] = [];
    for (const item of jsonItems) {
        const match =
            item.contentType === 'movie' && item.streamUrl
                ? movies.get(
                      `${item.playlistId}|${m3uMovieStableId(item.streamUrl)}`
                  )
                : undefined;
        if (!match) {
            merged.push(item);
        } else if (!claimed.has(match)) {
            claimed.add(match);
            merged.push({
                ...item,
                favoriteId: match.favorite_id,
                m3uCatalogId: match.xtream_id,
                position: match.position ?? item.position,
                addedAt: normalizeStalkerDate(match.added_at) || item.addedAt,
            });
        }
    }
    for (const row of catalog) {
        if (!claimed.has(row)) merged.push(mapM3uCatalogRow(row));
    }
    return merged;
}

/** Positions for the rows kept in the favorites table: Xtream and M3U catalog items. */
export function buildFavoritePositionUpdates(
    items: readonly UnifiedCollectionItem[]
): ElectronBridgeFavoriteReorderUpdate[] {
    const updates: ElectronBridgeFavoriteReorderUpdate[] = [];
    for (const item of items) {
        const stored =
            item.sourceType === 'xtream'
                ? item.favoriteId != null || item.contentId != null
                : item.m3uCatalogId != null && item.favoriteId != null;
        if (stored) {
            updates.push({
                ...(item.favoriteId != null
                    ? { favorite_id: item.favoriteId }
                    : { content_id: item.contentId }),
                playlist_id: item.playlistId,
                position: updates.length,
            });
        }
    }
    return updates;
}
