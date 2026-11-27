import { DestroyRef, inject, Injectable } from '@angular/core';
import { createLogger, PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { DataService } from '@iptvnator/services';
import {
    hasReachedPlaybackStart,
    type ExternalPlaybackEnded,
    type ExternalPlayerName,
    type ExternalPlayerSession,
    type PlayerContentInfo,
    type ResolvedPortalPlayback,
    type XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { M3uSeriesExternalPositions } from './m3u-series-external-positions';

export function m3uEpisodeContentInfo(
    playlistId: string,
    seriesId: number,
    episode: XtreamSerieEpisode
): PlayerContentInfo {
    return {
        playlistId,
        contentXtreamId: Number(episode.id),
        contentType: 'episode',
        seriesXtreamId: seriesId,
        seasonNumber: episode.season,
        episodeNumber: episode.episode_num,
    };
}

@Injectable()
export class M3uSeriesExternalAutoplay {
    private readonly runtime = inject(DataService, { optional: true });
    private readonly positions = inject(M3uSeriesExternalPositions);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly destroyRef = inject(DestroyRef);
    private readonly logger = createLogger('M3uSeriesExternalAutoplay');
    private session: {
        id: string;
        startTime: number;
        resumeSettled: boolean;
        ended: boolean;
    } | null = null;
    private launchOrder = 0;

    connect(
        onEnded: (event: ExternalPlaybackEnded) => Promise<void> | void,
        onStarted: () => void
    ): void {
        this.positions.connect((id, position) => {
            const session = this.session;
            if (session?.id !== id || session.ended) return false;
            if (
                !session.resumeSettled &&
                hasReachedPlaybackStart(
                    {
                        currentTime: position.positionSeconds,
                        duration: position.durationSeconds ?? 0,
                    },
                    session.startTime
                )
            ) {
                session.resumeSettled = true;
                onStarted();
            }
            return session.resumeSettled;
        });
        const unsubscribe = this.runtime?.onExternalPlaybackEnded?.((event) => {
            const session = this.session;
            if (session?.id !== event.sessionId || session.ended) return;
            session.ended = true;
            if (!session.resumeSettled) onStarted();
            void this.positions.complete(event);
            void onEnded(event);
        });
        if (unsubscribe) this.destroyRef.onDestroy(unsubscribe);
        this.destroyRef.onDestroy(() => this.release());
    }

    owns(sessionId: string): boolean {
        return this.session?.id === sessionId;
    }

    release(): void {
        this.launchOrder++;
        if (this.session) this.positions.release();
        this.session = null;
    }

    async open(
        playback: ResolvedPortalPlayback,
        player?: ExternalPlayerName,
        explicitPlayer = false
    ): Promise<ExternalPlayerSession | void> {
        this.release();
        const order = this.launchOrder;
        const { contentInfo, ...media } = playback;
        const { vlcContinuationSessionId } = media;
        const request: ResolvedPortalPlayback =
            player === 'vlc' && contentInfo
                ? { ...media, contentInfo: { ...contentInfo, m3uSeries: true } }
                : media;
        try {
            const session = await (player && explicitPlayer
                ? this.portalPlayer.openExternalPlayback(request, player)
                : this.portalPlayer.openResolvedPlayback(request, true));
            if (
                order !== this.launchOrder ||
                !session ||
                session.status === 'closed' ||
                session.status === 'error' ||
                session.id === vlcContinuationSessionId
            )
                return vlcContinuationSessionId ? undefined : session;
            if (player === 'vlc') {
                this.session = {
                    id: session.id,
                    startTime: playback.startTime ?? 0,
                    resumeSettled: false,
                    ended: false,
                };
            }
            return session;
        } catch (error) {
            if (explicitPlayer && !vlcContinuationSessionId) throw error;
            this.logger.warn('External episode launch failed');
        }
    }
}
