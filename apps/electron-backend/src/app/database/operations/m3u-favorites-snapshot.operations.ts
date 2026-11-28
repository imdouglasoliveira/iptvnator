import { and, eq, inArray, sql } from 'drizzle-orm';
import {
    parseJsonValue,
    PLAYLIST_TYPES,
} from '@iptvnator/shared/database/app-playlist';
import {
    m3uCatalogSnapshots as snapshots,
    playlists,
} from '@iptvnator/shared/database/schema';
import type { Channel, M3uFavoriteChannel } from '@iptvnator/shared/interfaces';
import { M3U_PRIORITY_OPEN_KILL_SWITCH } from '@iptvnator/shared/interfaces/ipc-commands';
import {
    isM3uSeriesFavoriteKey,
    M3U_CLASSIFIER_VERSION,
} from '@iptvnator/shared/m3u-utils/catalog';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import type { AppDatabase } from '../database.types';

export const m3uPlaylistType = inArray(playlists.type, [
    PLAYLIST_TYPES.M3U_FILE,
    PLAYLIST_TYPES.M3U_TEXT,
    PLAYLIST_TYPES.M3U_URL,
]);

export function m3uPriorityOpenEnabled() {
    return process.env[M3U_PRIORITY_OPEN_KILL_SWITCH] !== '1';
}

const currentSnapshot = and(
    eq(snapshots.playlistId, playlists.id),
    eq(snapshots.itemsRevision, playlists.itemsRevision),
    eq(snapshots.classifierVersion, M3U_CLASSIFIER_VERSION)
);

export function getM3uFavoritesSnapshot(
    db: AppDatabase,
    playlistId: string,
    onMissing?: (revision: number) => void
): string | null {
    if (!m3uPriorityOpenEnabled()) return null;
    try {
        const row = db.select({
            revision: playlists.itemsRevision,
            sourceFavorites: playlists.favorites,
            snapshot: sql<string | null>`CASE
                WHEN json_valid(${snapshots.favorites})
                THEN CASE WHEN json_extract(${snapshots.favorites}, '$.sourceFavorites') IS ${playlists.favorites}
                    THEN json_set(${snapshots.favorites}, '$.userAgent', ${playlists.userAgent}, '$.referrer', ${playlists.referrer})
                END
            END`,
        }).from(playlists)
            .leftJoin(snapshots, currentSnapshot)
            .where(and(eq(playlists.id, playlistId), m3uPlaylistType))
            .get();
        if (row?.snapshot === null && favoriteIds(row.sourceFavorites).length)
            onMissing?.(row.revision);
        return row?.snapshot ?? null;
    } catch {
        console.warn(redactSensitiveData({ event: 'm3u-favorites-snapshot-query-failed' }));
        return null;
    }
}

function favoriteIds(raw: string | null): string[] {
    const value = parseJsonValue<unknown>(raw, []);
    return Array.isArray(value)
        ? value.filter(
              (id): id is string =>
                  typeof id === 'string' &&
                  id.trim().length > 0 &&
                  !isM3uSeriesFavoriteKey(id)
          )
        : [];
}

export function* scanM3uFavoriteChannels(
    channels: Iterable<Channel>,
    favorites: readonly string[]
): Generator<void, M3uFavoriteChannel[]> {
    const positions = new Map<string, number>();
    favorites.forEach((id, index) => {
        if (!positions.has(id)) positions.set(id, index);
    });
    const resolved: M3uFavoriteChannel[] = [];
    if (!positions.size) return resolved;
    let scanned = 0;
    for (const channel of channels) {
        if (++scanned % 4096 === 0) yield;
        if (!channel) continue;
        const id = String(channel.id ?? '').trim();
        const url = String(channel.url ?? '').trim();
        const idPosition = positions.get(id) ?? Infinity;
        const urlPosition = positions.get(url) ?? Infinity;
        const favoriteIndex = Math.min(idPosition, urlPosition);
        if (!Number.isFinite(favoriteIndex)) continue;
        const favoriteId = favorites[favoriteIndex];
        resolved.push({ favoriteId, favoriteIndex, channel });
        positions.delete(favoriteId);
        if (!positions.size) break;
    }
    return resolved.sort((a, b) => a.favoriteIndex - b.favoriteIndex);
}

export function resolveM3uFavoriteChannels(
    channels: Iterable<Channel>,
    favorites: readonly string[]
) {
    const scan = scanM3uFavoriteChannels(channels, favorites);
    let step = scan.next();
    while (!step.done) step = scan.next();
    return step.value;
}

type SnapshotWriter = Pick<AppDatabase, 'select' | 'insert'>;
type FavoritesWriter = SnapshotWriter & Pick<AppDatabase, 'all'>;

export function readM3uFavoritesSource(
    db: Pick<AppDatabase, 'select'>,
    playlistId: string
) {
    return db
        .select({ revision: playlists.itemsRevision, favorites: playlists.favorites })
        .from(playlists)
        .where(and(eq(playlists.id, playlistId), m3uPlaylistType))
        .get();
}

export function* prepareM3uFavorites(
    channels: readonly Channel[],
    sourceFavorites: string | null
) {
    const ids = favoriteIds(sourceFavorites);
    const resolved = yield* scanM3uFavoriteChannels(channels, ids);
    return resolved.map(({ channel }) => channel);
}

export function saveM3uFavorites(
    db: SnapshotWriter,
    playlistId: string,
    itemsRevision: number,
    sourceFavorites: string | null,
    channels: Channel[]
) {
    const favorites = JSON.stringify({
        itemsRevision,
        sourceFavorites,
        favoriteIds: favoriteIds(sourceFavorites),
        channels,
    });
    const classifierVersion = M3U_CLASSIFIER_VERSION;
    const updatedAt = new Date().toISOString();
    const keepCatalog = sql`CASE WHEN ${snapshots.itemsRevision} = ${itemsRevision}
        AND ${snapshots.classifierVersion} = ${classifierVersion}
        THEN ${snapshots.data} ELSE '' END`;
    db.insert(snapshots)
        .values({
            playlistId, itemsRevision, classifierVersion, favorites, data: '', updatedAt,
        })
        .onConflictDoUpdate({
            target: snapshots.playlistId,
            set: {
                itemsRevision, classifierVersion, favorites, data: keepCatalog, updatedAt,
            },
        }).run();
}

export function updateM3uFavoritesSnapshot(
    db: FavoritesWriter,
    playlistId: string,
    previous: string | null,
    next: string
) {
    if (!m3uPriorityOpenEnabled()) return;
    try {
        const source = readM3uFavoritesSource(db, playlistId);
        if (!source || source.favorites !== next) return;
        const ids = favoriteIds(next);
        const cached = db.select({ favorites: snapshots.favorites })
            .from(snapshots)
            .innerJoin(playlists, currentSnapshot)
            .where(eq(snapshots.playlistId, playlistId))
            .get();
        const existing = parseJsonValue<{ sourceFavorites: string | null; channels: Channel[] } | null>(
            cached?.favorites ?? null, null
        );
        const previousIds = new Set(favoriteIds(previous));
        const canReuse =
            existing !== null &&
            existing.sourceFavorites === previous &&
            Array.isArray(existing.channels) &&
            ids.every((id) => previousIds.has(id));
        const candidates = canReuse
            ? existing.channels
            : readFavoriteCandidates(db, playlistId, ids);
        const channels = resolveM3uFavoriteChannels(candidates, ids).map(
            ({ channel }) => channel
        );
        saveM3uFavorites(db, playlistId, source.revision, next, channels);
    } catch {
        console.warn(redactSensitiveData({ event: 'm3u-favorites-snapshot-write-failed' }));
    }
}

export function readFavoriteCandidates(
    db: Pick<AppDatabase, 'all'>,
    playlistId: string,
    ids: string[]
): Channel[] {
    if (!ids.length) return [];
    return db.all<{ channel: string }>(sql`
        WITH wanted AS (SELECT value FROM json_each(${JSON.stringify(ids)}))
        SELECT item.value AS channel FROM ${playlists},
            json_each(CASE WHEN json_valid(${playlists.payload}) THEN ${playlists.payload} END, '$.playlist.items') AS item
        WHERE ${playlists.id} = ${playlistId} AND item.type = 'object'
            AND (trim(json_extract(item.value, '$.url')) IN (SELECT value FROM wanted)
                OR trim(json_extract(item.value, '$.id')) IN (SELECT value FROM wanted))
        ORDER BY item.key
    `).map(({ channel }) => JSON.parse(channel) as Channel);
}
