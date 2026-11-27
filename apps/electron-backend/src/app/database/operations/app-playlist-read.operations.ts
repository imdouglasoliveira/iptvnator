import { eq } from 'drizzle-orm';
import { playlists } from '@iptvnator/shared/database/schema';
import {
    getPlaylistItemCount,
    parseAppPlaylist,
} from '@iptvnator/shared/database/app-playlist';
import {
    APP_PLAYLIST_GET_PERFORMANCE_PHASE,
    type AppPlaylistGetPerformancePhase,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import type { DatabaseOperationPerformancePhaseCapture } from './performance-phase-capture';

export type AppPlaylistGetPhaseCapture =
    DatabaseOperationPerformancePhaseCapture<AppPlaylistGetPerformancePhase>;

export async function getAppPlaylist(
    db: AppDatabase,
    playlistId: string,
    capturePhase?: AppPlaylistGetPhaseCapture
) {
    const read = () =>
        db.select().from(playlists).where(eq(playlists.id, playlistId)).limit(1);
    const rows = capturePhase
        ? await capturePhase.captureAsync(
              APP_PLAYLIST_GET_PERFORMANCE_PHASE.SQLITE_READ,
              read,
              (value) => ({ itemCount: value.length })
          )
        : await read();
    const deserialize = () => (rows[0] ? parseAppPlaylist(rows[0]) : null);

    return capturePhase
        ? capturePhase.captureSync(
              APP_PLAYLIST_GET_PERFORMANCE_PHASE.DESERIALIZE_PLAYLIST,
              deserialize,
              (value) => ({
                  itemCount: value ? (getPlaylistItemCount(value) ?? 0) : 0,
              })
          )
        : deserialize();
}
