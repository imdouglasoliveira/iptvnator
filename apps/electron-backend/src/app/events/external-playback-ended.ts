import type {
    ExternalPlaybackEnded,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import type { ExternalPlaybackSnapshot } from './external-player-runtime';

export function createExternalPlaybackEndDetector(
    sessionId: string,
    contentInfo: PlayerContentInfo | undefined,
    emit: (event: ExternalPlaybackEnded) => void
): (
    state: string | null,
    snapshot: ExternalPlaybackSnapshot | null
) => boolean {
    let positionSeconds = 0;
    let durationSeconds = 0;
    let emitted = false;
    return observe;

    function observe(
        state: string | null,
        snapshot: ExternalPlaybackSnapshot | null
    ): boolean {
        if (contentInfo?.contentType !== 'episode' || !contentInfo.m3uSeries)
            return false;
        if (emitted) return true;
        if (snapshot) {
            const { positionSeconds: position, durationSeconds: duration } =
                snapshot;
            if (
                typeof duration === 'number' &&
                Number.isFinite(duration) &&
                duration > 0
            )
                durationSeconds = duration;
            // VLC may reset its clock once the input closes.
            if (
                Number.isFinite(position) &&
                (position > 0 || (position === 0 && state !== 'stopped'))
            )
                positionSeconds = position;
        }
        if (
            state !== 'stopped' ||
            durationSeconds <= 0 ||
            positionSeconds <= 0 ||
            positionSeconds < durationSeconds - 5
        ) {
            return false;
        }
        emitted = true;
        emit({ sessionId, contentInfo, positionSeconds, durationSeconds });
        return true;
    }
}
