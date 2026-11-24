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
            })
            .from(stored)
            .where(eq(stored.id, request.playlistId))
            .get();
        if (!row) return { status: 'unavailable', reason: 'missing' };
        if (!M3U_TYPES.has(row.type))
            return { status: 'unavailable', reason: 'not-m3u' };
        const current = parseStoredHistory(row.recentlyViewed);
        if (!current) return { status: 'unavailable', reason: 'unreadable' };

        const next = applyM3uHistoryCommand(
            current,
            request.command as M3uHistoryCommand
        );
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
    const keepHistory = !m3uActivityPartialWriteDisabled();
    db.insert(stored)
        .values(row)
        .onConflictDoUpdate({
            target: stored.id,
            set: {
                ...playlistConflictUpdate(row, playlist),
                ...(keepHistory
                    ? { recentlyViewed: sql`${stored.recentlyViewed}` }
                    : {}),
            },
        })
        .run();
    return { success: true };
}
