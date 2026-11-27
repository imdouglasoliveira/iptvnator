import {
    isPortalPlaybackInProgress,
    parseDurationSeconds,
} from '@iptvnator/portal/shared/util';
import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';

export function parseDuration(duration: string | number | undefined): number {
    return parseDurationSeconds(duration);
}

/** The episode runtime: the provider's `duration_secs` first, then its formatted `duration`. */
export function episodeRuntimeSeconds(
    info: { duration_secs?: number; duration?: string } | null | undefined
): number {
    const seconds = Number(info?.duration_secs);
    return Number.isFinite(seconds) && seconds > 0
        ? Math.floor(seconds)
        : parseDuration(info?.duration);
}

/** The selected season's most recently updated unfinished episode. */
export function findMostRecentInProgressEpisodeId(
    episodes: readonly XtreamSerieEpisode[],
    playbackPositions: ReadonlyMap<number, PlaybackPositionData>
): number | null {
    let best: { id: number; updatedAt: string } | null = null;
    for (const episode of episodes) {
        const id = Number(episode.id);
        const position = playbackPositions.get(id);
        if (!isPortalPlaybackInProgress(position)) {
            continue;
        }
        const updatedAt = position?.updatedAt ?? '';
        if (!best || updatedAt > best.updatedAt) {
            best = { id, updatedAt };
        }
    }
    return best?.id ?? null;
}
