import { normalizeStalkerDate } from '@iptvnator/shared/interfaces';
import {
    buildXtreamCollectionUid,
    UnifiedCollectionItem,
    xtreamContentType,
    XtreamFavoriteRow,
} from '@iptvnator/portal/shared/util';
import type { XtreamFavoriteItem } from '@iptvnator/portal/xtream/data-access';

export function mapXtreamRow(row: XtreamFavoriteRow): UnifiedCollectionItem {
    const ct = xtreamContentType(row.type);
    return {
        uid: buildXtreamCollectionUid(row.playlist_id, ct, row.xtream_id),
        name: row.title,
        contentType: ct,
        sourceType: 'xtream',
        playlistId: row.playlist_id,
        playlistName: row.playlist_name ?? 'Xtream',
        logo: ct === 'live' ? (row.poster_url ?? null) : null,
        posterUrl: ct !== 'live' ? (row.poster_url ?? null) : null,
        xtreamId: row.xtream_id,
        categoryId: row.category_id ?? undefined,
        tvgId: ct === 'live' ? String(row.xtream_id) : undefined,
        rating: row.rating ?? undefined,
        tvArchive: row.tv_archive ?? null,
        tvArchiveDuration: row.tv_archive_duration ?? null,
        addedAt:
            normalizeStalkerDate(row.added_at) || new Date(0).toISOString(),
        position: row.position ?? 0,
        contentId: row.id ?? undefined,
        favoriteId: row.favorite_id,
        catalogStatus: row.catalog_status,
    };
}

export function mapXtreamContentItem(
    item: XtreamFavoriteItem,
    playlistId: string,
    playlistName?: string
): UnifiedCollectionItem {
    const ct = xtreamContentType(item.type);
    return {
        uid: buildXtreamCollectionUid(playlistId, ct, item.xtream_id),
        name: item.title,
        contentType: ct,
        sourceType: 'xtream',
        playlistId,
        playlistName: playlistName ?? item.playlist_name ?? 'Xtream',
        logo: ct === 'live' ? (item.poster_url ?? null) : null,
        posterUrl: ct !== 'live' ? (item.poster_url ?? null) : null,
        xtreamId: item.xtream_id,
        categoryId: item.category_id ?? undefined,
        tvgId: ct === 'live' ? String(item.xtream_id) : undefined,
        rating: item.rating ?? undefined,
        tvArchive: item.tv_archive ?? null,
        tvArchiveDuration: item.tv_archive_duration ?? null,
        addedAt:
            normalizeStalkerDate(item.added_at ?? item.added) ||
            new Date(0).toISOString(),
        position: item.position ?? 0,
        contentId: item.id ?? undefined,
        favoriteId: item.favorite_id,
        catalogStatus: item.catalog_status,
        xtreamIdentity: {
            tmdbId: item.tmdb_id ?? undefined,
            releaseYear: item.release_year ?? undefined,
        },
    };
}
