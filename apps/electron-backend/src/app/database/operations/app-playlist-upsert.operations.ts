import * as schema from '@iptvnator/shared/database/schema';
import {
    buildPlaylistRow,
    getPlaylistItemCount,
    playlistConflictUpdate,
} from '@iptvnator/shared/database/app-playlist';
import {
    APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE,
    type AppPlaylistUpsertPerformancePhase,
    type PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import {
    afterM3uDocumentWrite,
    captureM3uDocumentWrite,
    m3uDocumentSnapshotsEnabled,
    type ScheduleM3uSnapshot,
    type SnapshotJob,
} from './m3u-catalog-snapshot.operations';

export interface AppPlaylistUpsertPhaseCapture {
    captureAsync: <TResult>(
        phase: AppPlaylistUpsertPerformancePhase,
        execute: () => Promise<TResult>,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => Promise<TResult>;
    captureSync: <TResult>(
        phase: AppPlaylistUpsertPerformancePhase,
        execute: () => TResult,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => TResult;
}

function writePlaylist(
    db: Pick<AppDatabase, 'insert'>,
    row: schema.NewPlaylist,
    playlist: Record<string, unknown>
): void {
    db.insert(schema.playlists)
        .values(row)
        .onConflictDoUpdate({
            target: schema.playlists.id,
            set: playlistConflictUpdate(row, playlist),
        })
        .run();
}

export async function upsertAppPlaylist(
    db: AppDatabase,
    playlist: Record<string, unknown>,
    capturePhase?: AppPlaylistUpsertPhaseCapture,
    schedule: ScheduleM3uSnapshot = afterM3uDocumentWrite
): Promise<{ success: boolean }> {
    const row = capturePhase
        ? capturePhase.captureSync(
              APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SERIALIZE_PLAYLIST,
              () => buildPlaylistRow(playlist),
              () => ({
                  itemCount: getPlaylistItemCount(playlist),
              })
          )
        : buildPlaylistRow(playlist);
    if (!row) {
        throw new Error('Playlist ID is required for upsert');
    }

    const write = async () => {
        if (!m3uDocumentSnapshotsEnabled()) {
            writePlaylist(db, row, playlist);
            return;
        }
        return db.transaction(
            (tx) =>
                captureM3uDocumentWrite(tx, row, playlist, () =>
                    writePlaylist(tx, row, playlist)
                ),
            { behavior: 'immediate' }
        );
    };
    const job = capturePhase
        ? await capturePhase.captureAsync(
              APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE,
              write,
              () => ({ itemCount: 1 })
          )
        : await write();
    if (job) schedule(db, job);

    return { success: true };
}

export async function upsertAppPlaylists(
    db: AppDatabase,
    playlists: Record<string, unknown>[],
    schedule: ScheduleM3uSnapshot = afterM3uDocumentWrite
): Promise<{ success: boolean; count: number }> {
    if (!Array.isArray(playlists) || playlists.length === 0) {
        return { success: true, count: 0 };
    }

    const rows = playlists
        .map((playlist) => ({ playlist, row: buildPlaylistRow(playlist) }))
        .filter(
            (
                entry
            ): entry is {
                playlist: Record<string, unknown>;
                row: NonNullable<typeof entry.row>;
            } => entry.row !== null
        );

    if (rows.length === 0) {
        return { success: true, count: 0 };
    }

    const jobs = db.transaction(
        (tx) => {
            const changed: SnapshotJob[] = [];
            for (const { playlist, row } of rows) {
                const job = captureM3uDocumentWrite(tx, row, playlist, () =>
                    writePlaylist(tx, row, playlist)
                );
                if (job) changed.push(job);
            }
            return changed;
        },
        m3uDocumentSnapshotsEnabled() ? { behavior: 'immediate' } : undefined
    );
    for (const job of jobs) schedule(db, job);

    return { success: true, count: rows.length };
}
