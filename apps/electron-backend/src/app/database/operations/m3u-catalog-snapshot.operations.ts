import { setImmediate as nextTurn } from 'node:timers/promises';
import { and, eq, sql } from 'drizzle-orm';
import {
    m3uCatalogSnapshots as snapshots,
    playlists,
} from '@iptvnator/shared/database/schema';
import type { Channel } from '@iptvnator/shared/interfaces';
import { M3U_CATALOG_SNAPSHOT_KILL_SWITCH } from '@iptvnator/shared/interfaces/ipc-commands';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import { M3U_CLASSIFIER_VERSION } from '@iptvnator/shared/m3u-utils/catalog';
import type { AppDatabase } from '../database.types';
import { buildM3uCatalogSnapshot } from './m3u-catalog-snapshot-build';
import { readM3uSnapshotChannels } from './m3u-catalog-snapshot-payload';
import { serializeM3uCatalogSnapshot } from './m3u-catalog-snapshot-serialization';
import {
    m3uPlaylistType,
    m3uPriorityOpenEnabled,
    prepareM3uFavorites,
    readM3uFavoritesSource,
    saveM3uFavorites,
} from './m3u-favorites-snapshot.operations';

export interface SnapshotJob {
    playlistId: string;
    revision: number;
    channels?: readonly Channel[];
    favoritesOnly?: boolean;
}

export type ScheduleM3uSnapshot = typeof afterM3uDocumentWrite;

type RevisionReader = Pick<AppDatabase, 'select'>;

export function readM3uItemsRevision(db: RevisionReader, playlistId: string) {
    return db
        .select({ revision: playlists.itemsRevision })
        .from(playlists)
        .where(and(eq(playlists.id, playlistId), m3uPlaylistType))
        .get()?.revision;
}

export function m3uCatalogSnapshotEnabled(): boolean {
    return process.env[M3U_CATALOG_SNAPSHOT_KILL_SWITCH] !== '1';
}

export function m3uDocumentSnapshotsEnabled(): boolean {
    return m3uCatalogSnapshotEnabled() || m3uPriorityOpenEnabled();
}

export function m3uDocumentChannels(document: Record<string, unknown> | null) {
    const playlist = document?.['playlist'] as { items?: unknown } | undefined;
    return Array.isArray(playlist?.items)
        ? (playlist.items as Channel[])
        : undefined;
}

export function captureM3uDocumentWrite(
    db: RevisionReader,
    row: typeof playlists.$inferInsert,
    document: Record<string, unknown>,
    write: () => void
): SnapshotJob | undefined {
    const channels =
        m3uDocumentSnapshotsEnabled() && row.type.startsWith('m3u-')
            ? m3uDocumentChannels(document)
            : undefined;
    const before = channels && readM3uFavoritesSource(db, row.id);
    write();
    if (!channels) return undefined;
    const after = readM3uFavoritesSource(db, row.id);
    if (!after) return undefined;
    const favoritesOnly = after.revision === before?.revision;
    if (
        favoritesOnly &&
        (!m3uPriorityOpenEnabled() || after.favorites === before?.favorites)
    ) {
        return undefined;
    }
    return {
        playlistId: row.id,
        revision: after.revision,
        channels,
        ...(favoritesOnly && { favoritesOnly }),
    };
}

export function getM3uCatalogSnapshot(
    db: AppDatabase,
    playlistId: string,
    schedule: ScheduleM3uSnapshot = afterM3uDocumentWrite
): string | null {
    if (!m3uCatalogSnapshotEnabled()) return null;
    try {
        const row = db
            .select({
                revision: playlists.itemsRevision,
                data: sql<string | null>`nullif(${snapshots.data}, '')`,
            })
            .from(playlists)
            .leftJoin(
                snapshots,
                and(
                    eq(snapshots.playlistId, playlists.id),
                    eq(snapshots.itemsRevision, playlists.itemsRevision),
                    eq(snapshots.classifierVersion, M3U_CLASSIFIER_VERSION)
                )
            )
            .where(and(eq(playlists.id, playlistId), m3uPlaylistType))
            .get();
        if (!row) return null;
        if (row.data === null)
            schedule(db, { playlistId, revision: row.revision });
        return row.data;
    } catch {
        console.warn(
            redactSensitiveData({ event: 'm3u-catalog-snapshot-query-failed' })
        );
        return null;
    }
}

const jobsByDatabase = new WeakMap<AppDatabase, Map<string, SnapshotJob>>();

export function afterM3uDocumentWrite(
    db: AppDatabase,
    job?: SnapshotJob
): void {
    if (!job || !m3uDocumentSnapshotsEnabled()) return;
    const pending = jobsByDatabase.get(db);
    if (pending) {
        const existing = pending.get(job.playlistId);
        if (!existing || job.revision > existing.revision) {
            pending.set(job.playlistId, job);
        } else if (
            job.revision === existing.revision &&
            (job.channels || (existing.favoritesOnly && !job.favoritesOnly))
        ) {
            pending.set(job.playlistId, {
                ...job,
                channels: job.channels ?? existing.channels,
                favoritesOnly: job.favoritesOnly && existing.favoritesOnly,
            });
        }
        return;
    }
    const queue = new Map([[job.playlistId, job]]);
    jobsByDatabase.set(db, queue);
    void buildPendingSnapshots(db, queue);
}

async function buildPendingSnapshots(
    db: AppDatabase,
    queue: Map<string, SnapshotJob>
) {
    for (const [playlistId, job] of queue) {
        await nextTurn();
        const current = () => queue.get(playlistId) === job;
        try {
            if (
                current() &&
                readM3uItemsRevision(db, playlistId) === job.revision
            ) {
                await saveSnapshot(db, job, current);
            }
        } catch {
            console.warn(
                redactSensitiveData({
                    event: 'm3u-catalog-snapshot-build-failed',
                })
            );
        }
        if (current()) queue.delete(playlistId);
        else {
            const replacement = queue.get(playlistId);
            queue.delete(playlistId);
            if (replacement) queue.set(playlistId, replacement);
        }
    }
    jobsByDatabase.delete(db);
}

async function saveSnapshot(
    db: AppDatabase,
    job: SnapshotJob,
    current: () => boolean
) {
    const build = buildSnapshotData(db, job, current);
    let step = build.next();
    while (!step.done) {
        await nextTurn();
        if (!current() || !m3uDocumentSnapshotsEnabled()) return;
        step = build.next();
    }
    const data = step.value;
    if (data === undefined) return;
    const { playlistId, revision } = job;
    db.transaction(
        (tx) => {
            if (readM3uItemsRevision(tx, playlistId) !== revision) return;
            const values = {
                itemsRevision: revision,
                classifierVersion: M3U_CLASSIFIER_VERSION,
                data,
                updatedAt: new Date().toISOString(),
            };
            tx.insert(snapshots)
                .values({ playlistId, ...values })
                .onConflictDoUpdate({
                    target: snapshots.playlistId,
                    set: {
                        ...values,
                        favorites: sql`CASE WHEN ${snapshots.itemsRevision} = ${revision}
                            AND ${snapshots.classifierVersion} = ${M3U_CLASSIFIER_VERSION}
                            THEN ${snapshots.favorites} END`,
                    },
                })
                .run();
        },
        { behavior: 'immediate' }
    );
}

function* buildSnapshotData(
    db: AppDatabase,
    { channels, playlistId, revision, favoritesOnly }: SnapshotJob,
    current: () => boolean
): Generator<void, string | undefined> {
    if (!channels) {
        const row = db
            .select({ payload: playlists.payload })
            .from(playlists)
            .where(eq(playlists.id, playlistId))
            .get();
        if (!row?.payload) return undefined;
        yield;
        channels = yield* readM3uSnapshotChannels(row.payload);
    }
    if (!channels) return undefined;
    if (m3uPriorityOpenEnabled()) {
        const source = readM3uFavoritesSource(db, playlistId);
        if (source?.revision === revision) {
            const favorites = yield* prepareM3uFavorites(
                channels,
                source.favorites
            );
            if (current() && m3uPriorityOpenEnabled()) {
                db.transaction(
                    (tx) => {
                        const latest = readM3uFavoritesSource(tx, playlistId);
                        if (
                            latest?.revision === revision &&
                            latest.favorites === source.favorites
                        ) {
                            saveM3uFavorites(
                                tx, playlistId, revision, source.favorites, favorites
                            );
                        }
                    },
                    { behavior: 'immediate' }
                );
            }
        }
    }
    if (favoritesOnly || !m3uCatalogSnapshotEnabled() || !current())
        return undefined;
    const snapshot = yield* buildM3uCatalogSnapshot(channels, playlistId, revision);
    return yield* serializeM3uCatalogSnapshot(snapshot);
}
