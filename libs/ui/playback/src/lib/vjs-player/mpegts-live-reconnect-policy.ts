import {
    type MpegTsPlaybackEvidence,
    MpegTsPlaybackFailure,
} from '@iptvnator/playback/util';

export interface MpegTsLiveReconnectPolicy {
    readonly delaysMs: readonly number[];
    readonly stableWindowMs: number;
    readonly attemptTimeoutMs: number;
}

export const DEFAULT_MPEGTS_LIVE_RECONNECT_POLICY: MpegTsLiveReconnectPolicy = {
    delaysMs: [1000, 2000, 4000],
    stableWindowMs: 30_000,
    attemptTimeoutMs: 10_000,
};

/** Only transport failures of a live stream; auth and decode errors stay terminal. */
export function isReconnectableMpegTsFailure(
    evidence: MpegTsPlaybackEvidence
): boolean {
    switch (evidence.failure) {
        case MpegTsPlaybackFailure.Network:
        case MpegTsPlaybackFailure.Timeout:
        case MpegTsPlaybackFailure.TruncatedStream:
            return true;
        case MpegTsPlaybackFailure.Http: {
            const status = evidence.httpStatus;
            return (
                status !== undefined &&
                (status === 408 ||
                    status === 425 ||
                    status === 429 ||
                    (status >= 500 && status <= 599))
            );
        }
        default:
            return false;
    }
}
