// Docs: docs/architecture/sqlite-db-worker.md (M3U activity partial write).
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import {
    buildPlaylistRow,
    PLAYLIST_TYPES,
} from '@iptvnator/shared/database/app-playlist';
import {
    isM3uRecentlyViewedItem,
    M3U_ACTIVITY_COMMAND_KINDS,
    M3U_ACTIVITY_PARTIAL_WRITE_KILL_SWITCH_ENV,
    type M3uActivityMutationRequest,
    type M3uActivityMutationResult,
    type M3uFavoritesCommand,
    type M3uHistoryCommand,
    type PlaylistRecentIdentity,
    type PlaylistRecentlyViewedItem,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import { playlistConflictUpdate } from './playlist-server-timezone.operations';

const stored = schema.playlists;
const M3U_TYPES: ReadonlySet<string> = new Set([
    PLAYLIST_TYPES.M3U_FILE,
    PLAYLIST_TYPES.M3U_TEXT,
    PLAYLIST_TYPES.M3U_URL,
]);

export function m3uActivityPartialWriteDisabled(): boolean {
    return process.env[M3U_ACTIVITY_PARTIAL_WRITE_KILL_SWITCH_ENV] === '1';
}

function identityOf(item: PlaylistRecentlyViewedItem): string {
    return isM3uRecentlyViewedItem(item)
        ? String(item.url ?? item.id ?? '').trim()
        : '';
}

function matchesIdentity(
    item: PlaylistRecentlyViewedItem,
    identity: PlaylistRecentIdentity
): boolean {
    if (!isM3uRecentlyViewedItem(item)) return false;
    if (typeof identity === 'object') {
        return isM3uRecentlyViewedItem(identity) && item.url === identity.url;
    }
    const expected = String(identity ?? '').trim();
    return expected !== '' && identityOf(item) === expected;
}

/** Same semantics as the whole-document `mutatePlaylistHistory` for M3U rows. */
export function applyM3uHistoryCommand(
    current: PlaylistRecentlyViewedItem[],
    command: M3uHistoryCommand,
    nowIso = new Date().toISOString()
): PlaylistRecentlyViewedItem[] {
    switch (command.kind) {
        case 'history.touch': {
            const identity = identityOf(command.item);
            const index = current.findIndex(
                (item) => identity !== '' && identityOf(item) === identity
            );
            const existing = index >= 0 ? current[index] : null;
            return [
                { ...(existing ?? {}), ...command.item, added_at: nowIso },
                ...current.filter((_, i) => i !== index),
            ] as PlaylistRecentlyViewedItem[];
        }
        case 'history.remove':
            return current.filter(
                (item) =>
                    !command.identities.some((identity) =>
                        matchesIdentity(item, identity)
                    )
            );
        case 'history.clear':
            return [];
    }
}

/** Same semantics as the renderer toggle/reorder, applied to the stored list. */
export function applyM3uFavoritesCommand(
    current: string[],
    command: M3uFavoritesCommand
): string[] {
    if (command.kind === 'favorites.setMembership') {
        const others = current.filter((url) => url !== command.url);
        return command.present ? [...others, command.url] : others;
    }
    const present = new Set(current);
    const ordered = command.channelIds.filter((id) => present.has(id));
    const placed = new Set(ordered);
    return [...ordered, ...current.filter((id) => !placed.has(id))];
}

function parseStoredFavorites(raw: string | null): string[] | null {
    const parsed = parseStoredHistory(raw);
    return parsed && parsed.every((item) => typeof item === 'string')
        ? (parsed as unknown as string[])
        : null;
}

function parseStoredHistory(
    raw: string | null
): PlaylistRecentlyViewedItem[] | null {
    if (raw === null || raw === '') return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed)
            ? (parsed as PlaylistRecentlyViewedItem[])
            : null;
    } catch {
        return null;
    }
}

function isValidRequest(request: M3uActivityMutationRequest): boolean {
    const command = request?.command;
    if (!request?.playlistId || !command) return false;
    if (!M3U_ACTIVITY_COMMAND_KINDS.has(command.kind)) return false;
    if (command.kind === 'history.touch')
        return isM3uRecentlyViewedItem(command.item);
    if (command.kind === 'history.remove')
        return Array.isArray(command.identities);
    if (command.kind === 'favorites.setMembership')
        return typeof command.url === 'string' && command.url !== '';
    if (command.kind === 'favorites.reorder')
        return (
            Array.isArray(command.channelIds) &&
            command.channelIds.every((id) => typeof id === 'string')
        );
    return true;
}

export function mutateM3uActivity(
    db: AppDatabase,
    request: M3uActivityMutationRequest
): M3uActivityMutationResult {
    if (m3uActivityPartialWriteDisabled())
        return { status: 'unavailable', reason: 'disabled' };
    if (!isValidRequest(request))
        return { status: 'unavailable', reason: 'unreadable' };

    return db.transaction((tx): M3uActivityMutationResult => {
        const row = tx
            .select({
                type: stored.type,
                recentlyViewed: stored.recentlyViewed,
                favorites: stored.favorites,
            })
            .from(stored)
            .where(eq(stored.id, request.playlistId))
            .get();
        if (!row) return { status: 'unavailable', reason: 'missing' };
        if (!M3U_TYPES.has(row.type))
            return { status: 'unavailable', reason: 'not-m3u' };
        const command = request.command;
        if (
            command.kind === 'favorites.setMembership' ||
            command.kind === 'favorites.reorder'
        ) {
            const current = parseStoredFavorites(row.favorites);
            if (!current)
                return { status: 'unavailable', reason: 'unreadable' };
            const next = applyM3uFavoritesCommand(current, command);
            const result = tx
                .update(stored)
                .set({ favorites: JSON.stringify(next) })
                .where(
                    and(
                        eq(stored.id, request.playlistId),
                        sql`${stored.favorites} IS ${row.favorites}`
                    )
                )
                .run();
            if (result.changes !== 1)
                throw new Error('m3u_activity_cas_conflict');
            return { status: 'applied', favorites: next };
        }

        const current = parseStoredHistory(row.recentlyViewed);
        if (!current) return { status: 'unavailable', reason: 'unreadable' };

        const next = applyM3uHistoryCommand(current, command);
        const result = tx
            .update(stored)
            .set({ recentlyViewed: JSON.stringify(next) })
            .where(
                and(
                    eq(stored.id, request.playlistId),
                    sql`${stored.recentlyViewed} IS ${row.recentlyViewed}`
                )
            )
            .run();
        // The CAS cannot miss inside this transaction; fail closed anyway.
        if (result.changes !== 1) throw new Error('m3u_activity_cas_conflict');
        return { status: 'applied', recentlyViewed: next };
    });
}

// A refresh snapshot built before a tap must not bring old history back.
export function upsertAppPlaylistKeepingActivity(
    db: AppDatabase,
    playlist: Record<string, unknown>
): { success: boolean } {
    const row = buildPlaylistRow(playlist);
    if (!row) throw new Error('Playlist ID is required for upsert');
    const keepActivity = !m3uActivityPartialWriteDisabled();
    db.insert(stored)
        .values(row)
        .onConflictDoUpdate({
            target: stored.id,
            set: {
                ...playlistConflictUpdate(row, playlist),
                ...(keepActivity
                    ? {
                          recentlyViewed: sql`${stored.recentlyViewed}`,
                          favorites: sql`${stored.favorites}`,
                      }
                    : {}),
            },
        })
        .run();
    return { success: true };
}
