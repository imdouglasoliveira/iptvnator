import { DestroyRef, inject, Injectable } from '@angular/core';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import type {
    ExternalPlaybackEnded,
    PlaybackPositionData,
} from '@iptvnator/shared/interfaces';
import { M3uSeriesPositionsService } from './m3u-series-positions.service';

@Injectable()
export class M3uSeriesExternalPositions {
    private readonly bridge = inject(PlaybackPositionRuntimeBridgeService);
    private readonly positions = inject(M3uSeriesPositionsService);
    private readonly destroyRef = inject(DestroyRef);

    connect(
        owns: (sessionId: string, position: PlaybackPositionData) => boolean
    ): void {
        const unsubscribe = this.bridge.onPlaybackPositionUpdate((position) => {
            if (
                !position.sessionId ||
                !position.playlistId ||
                position.activityOnly ||
                position.contentType !== 'episode' ||
                !Number.isFinite(position.positionSeconds) ||
                position.positionSeconds < 0 ||
                !owns(position.sessionId, position)
            )
                return;

            void this.positions.recordProgress(position.playlistId, position);
        });
        if (unsubscribe) this.destroyRef.onDestroy(unsubscribe);
    }

    complete(event: ExternalPlaybackEnded): Promise<void> {
        return this.positions.recordProgress(
            event.contentInfo.playlistId,
            {
                ...event.contentInfo,
                positionSeconds: event.durationSeconds,
                durationSeconds: event.durationSeconds,
                watched: true,
            },
            true
        );
    }

    release(): void {
        this.positions.releaseProgressThrottle();
    }
}
