import type { JourneyIterationRecord } from './journey-summary';
import type { OpenM3uJourneyProbeState } from './open-m3u-journey-probe';

export const OPEN_M3U_JOURNEY_ID = 'open-m3u';

export function toOpenM3uIterationRecord(
    index: number,
    warmup: boolean,
    pid: number,
    probe: Pick<
        OpenM3uJourneyProbeState,
        | 'clickMs'
        | 'firstChannelMs'
        | 'firstFavoriteMs'
        | 'fullListMs'
        | 'catalogBuildsOnOpen'
    >
): JourneyIterationRecord {
    const {
        clickMs,
        firstChannelMs,
        firstFavoriteMs,
        fullListMs,
        catalogBuildsOnOpen,
    } = probe;
    if (
        clickMs === null ||
        firstChannelMs === null ||
        firstFavoriteMs === null ||
        fullListMs === null ||
        ![clickMs, firstChannelMs, firstFavoriteMs, fullListMs].every(
            Number.isFinite
        )
    ) {
        throw new Error('open-m3u-journey-record-incomplete-probe');
    }
    if (
        clickMs < 0 ||
        firstChannelMs < clickMs ||
        firstFavoriteMs < firstChannelMs ||
        fullListMs < firstChannelMs
    ) {
        throw new Error('open-m3u-journey-record-clock-order');
    }
    if (!Number.isSafeInteger(catalogBuildsOnOpen) || catalogBuildsOnOpen < 0) {
        throw new Error('open-m3u-journey-record-invalid-build-count');
    }
    const elapsed = (endMs: number) => Math.round((endMs - clickMs) * 10) / 10;
    return {
        counters: { 'renderer.catalogBuildsOnOpen': catalogBuildsOnOpen },
        evidence: {
            monotonicMs: { clickMs, firstChannelMs, firstFavoriteMs, fullListMs },
        },
        index,
        pid,
        wallClock: {
            clickToFirstChannelMs: elapsed(firstChannelMs),
            clickToFirstFavoriteMs: elapsed(firstFavoriteMs),
            clickToFullListMs: elapsed(fullListMs),
        },
        warmup,
    };
}
