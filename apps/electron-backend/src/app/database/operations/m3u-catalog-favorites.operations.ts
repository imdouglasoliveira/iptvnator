// Docs: docs/architecture/sqlite-db-worker.md (M3U catalog favorites).
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import {
    M3U_CATALOG_FAVORITES_MARK_PREFIX,
    m3uCatalogFavoritesMarkKey,
    type M3uCatalogFavoriteIdsRequest,
    type M3uCatalogFavoriteSetRequest,
    type M3uCatalogFavoriteSetResult,
} from '@iptvnator/shared/interfaces';
import {
    classifyM3uEntry,
    isM3uSeriesFavoriteKey,
    m3uMovieStableId,
    m3uSeriesFavoriteKey,
} from '@iptvnator/shared/m3u-utils/catalog';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import type { AppDatabase } from '../database.types';
import { parseStoredFavorites } from './m3u-activity.operations';
import {
    m3uPlaylistType,
    readFavoriteCandidates,
    resolveM3uFavoriteChannels,
    updateM3uFavoritesSnapshot,
} from './m3u-favorites-snapshot.operations';

const stored = schema.playlists;
const table = schema.favorites;
const IDENTITY = [table.playlistId, table.type, table.xtreamId];

function isValidRequest(request: M3uCatalogFavoriteSetRequest): boolean {
    return (
        !!request &&
        typeof request.playlistId === 'string' &&
        request.playlistId !== '' &&
        (request.type === 'movie' || request.type === 'series') &&
        Number.isSafeInteger(request.stableId) &&
        request.stableId > 0 &&
        typeof request.favorite === 'boolean' &&
        (!request.favorite ||
            (typeof request.title === 'string' && request.title.trim() !== ''))
    );
}

function nextFavorites(
    current: string[],
    request: M3uCatalogFavoriteSetRequest
): string[] {
    if (request.type === 'series') {
        const key = m3uSeriesFavoriteKey(request.stableId);
        if (!request.favorite) return current.filter((entry) => entry !== key);
        return current.includes(key) ? current : [...current, key];
    }
    const url = String(request.url ?? '').trim();
    const sameMovie = (entry: string) =>
        !isM3uSeriesFavoriteKey(entry) &&
        m3uMovieStableId(entry) === request.stableId;
    if (request.favorite) {
        return !url || current.some(sameMovie) ? current : [...current, url];
    }
    return current.filter((entry) => entry !== url && !sameMovie(entry));
}

function writeJsonFavorites(
    tx: Pick<AppDatabase, 'select' | 'update' | 'insert' | 'all'>,
    request: M3uCatalogFavoriteSetRequest,
    rawFavorites: string | null
): void {
    const current = parseStoredFavorites(rawFavorites);
    if (!current) return;
    const next = nextFavorites(current, request);
    if (next.length === current.length && next.every((v, i) => v === current[i]))
        return;
    const encoded = JSON.stringify(next);
    const result = tx
        .update(stored)
        .set({ favorites: encoded })
        .where(
            and(
                eq(stored.id, request.playlistId),
                sql`${stored.favorites} IS ${rawFavorites}`
            )
        )
        .run();
    if (result.changes !== 1)
        throw new Error('m3u_catalog_favorite_cas_conflict');
    updateM3uFavoritesSnapshot(tx, request.playlistId, rawFavorites, encoded);
}

export function setM3uCatalogFavorite(
    db: AppDatabase,
    request: M3uCatalogFavoriteSetRequest
): M3uCatalogFavoriteSetResult {
    if (!isValidRequest(request))
        throw new Error('invalid_m3u_catalog_favorite');
    ensureM3uCatalogFavoritesCopied(db, request.playlistId);
    return db.transaction((tx): M3uCatalogFavoriteSetResult => {
        const row = tx
            .select({ favorites: stored.favorites })
            .from(stored)
            .where(and(eq(stored.id, request.playlistId), m3uPlaylistType))
            .get();
        if (!row) throw new Error('m3u_catalog_favorite_playlist_missing');
        let favoriteId: number | null = null;
        if (request.favorite) {
            const title = request.title.trim();
            favoriteId = tx
                .insert(table)
                .values({
                    contentId: null,
                    playlistId: request.playlistId,
                    type: request.type,
                    xtreamId: request.stableId,
                    title,
                    posterUrl: request.posterUrl ?? null,
                    backdropUrl: request.backdropUrl ?? null,
                })
                .onConflictDoUpdate({
                    target: IDENTITY,
                    set: {
                        title,
                        posterUrl: sql`COALESCE(excluded.poster_url, ${table.posterUrl})`,
                        backdropUrl: sql`COALESCE(excluded.backdrop_url, ${table.backdropUrl})`,
                    },
                })
                .returning({ id: table.id })
                .get().id;
        } else {
            tx.delete(table)
                .where(
                    and(
                        eq(table.playlistId, request.playlistId),
                        eq(table.type, request.type),
                        eq(table.xtreamId, request.stableId)
                    )
                )
                .run();
        }
        writeJsonFavorites(tx, request, row.favorites);
        return { favoriteId };
    });
}

export function getM3uCatalogFavoriteIds(
    db: AppDatabase,
    request: M3uCatalogFavoriteIdsRequest
): number[] {
    if (
        !request?.playlistId ||
        (request.type !== 'movie' && request.type !== 'series')
    )
        throw new Error('invalid_m3u_catalog_favorite');
    ensureM3uCatalogFavoritesCopied(db, request.playlistId);
    return db
        .select({ xtreamId: table.xtreamId })
        .from(table)
        .where(
            and(
                eq(table.playlistId, request.playlistId),
                eq(table.type, request.type)
            )
        )
        .orderBy(asc(table.position), desc(table.addedAt), desc(table.id))
        .all()
        .map(({ xtreamId }) => xtreamId);
}

export interface M3uCatalogFavoritesCopyResult {
    copied: number;
    skipped: boolean;
}

function hasItemsPayload(
    tx: Pick<AppDatabase, 'select'>,
    playlistId: string
): boolean {
    return (
        tx
            .select({
                ok: sql<number>`CASE WHEN json_valid(${stored.payload})
                    THEN json_type(${stored.payload}, '$.playlist.items') = 'array' ELSE 0 END`,
            })
            .from(stored)
            .where(eq(stored.id, playlistId))
            .get()?.ok === 1
    );
}

/** Copies the movie URLs already favorited in the playlist JSON; the JSON keeps them. */
export function copyM3uCatalogFavoritesFromJson(
    db: AppDatabase,
    playlistId: string
): M3uCatalogFavoritesCopyResult {
    const skipped = { copied: 0, skipped: true };
    return db.transaction((tx): M3uCatalogFavoritesCopyResult => {
        const markKey = m3uCatalogFavoritesMarkKey(playlistId);
        const marked = tx
            .select({ key: schema.appState.key })
            .from(schema.appState)
            .where(eq(schema.appState.key, markKey))
            .get();
        if (marked) return skipped;
        const row = tx
            .select({ favorites: stored.favorites })
            .from(stored)
            .where(and(eq(stored.id, playlistId), m3uPlaylistType))
            .get();
        const entries = row ? parseStoredFavorites(row.favorites) : null;
        if (!entries) return skipped;
        const ids = entries.filter((entry) => !isM3uSeriesFavoriteKey(entry));
        let copied = 0;
        if (ids.length) {
            const candidates = readFavoriteCandidates(tx, playlistId, ids);
            if (!candidates.length && !hasItemsPayload(tx, playlistId))
                return skipped;
            for (const { channel } of resolveM3uFavoriteChannels(
                candidates,
                ids
            )) {
                if (!channel.url || classifyM3uEntry(channel) !== 'movie')
                    continue;
                copied += tx
                    .insert(table)
                    .values({
                        contentId: null,
                        playlistId,
                        type: 'movie',
                        xtreamId: m3uMovieStableId(channel.url),
                        title: String(channel.name ?? '').trim() || 'Movie',
                        posterUrl: channel.tvg?.logo?.trim() || null,
                    })
                    .onConflictDoNothing({ target: IDENTITY })
                    .run().changes;
            }
        }
        tx.insert(schema.appState)
            .values({
                key: markKey,
                value: 'done',
                updatedAt: new Date().toISOString(),
            })
            .onConflictDoNothing()
            .run();
        return { copied, skipped: false };
    });
}

function ensureM3uCatalogFavoritesCopied(
    db: AppDatabase,
    playlistId: string
): M3uCatalogFavoritesCopyResult {
    try {
        return copyM3uCatalogFavoritesFromJson(db, playlistId);
    } catch {
        console.warn(
            redactSensitiveData({ event: 'm3u-catalog-favorites-copy-failed' })
        );
        return { copied: 0, skipped: true };
    }
}

/** Playlists with JSON favorites and no mark yet: the only ones the copy has to look at. */
export function copyAllM3uCatalogFavoritesFromJson(db: AppDatabase): number {
    const pending = db
        .select({ id: stored.id })
        .from(stored)
        .where(
            and(
                m3uPlaylistType,
                sql`${stored.favorites} IS NOT NULL AND ${stored.favorites} NOT IN ('', '[]')`,
                sql`NOT EXISTS (SELECT 1 FROM app_state WHERE app_state.key = ${M3U_CATALOG_FAVORITES_MARK_PREFIX} || ${stored.id})`
            )
        )
        .all();
    return pending.reduce(
        (total, { id }) =>
            total + ensureM3uCatalogFavoritesCopied(db, id).copied,
        0
    );
}
