import {
    type MpegTsPlaybackEvidence,
    MpegTsPlaybackDisposition,
    MpegTsPlaybackEngineDetails,
    MpegTsPlaybackEngineType,
    MpegTsPlaybackFailure,
    MpegTsPlaybackStage,
} from '@iptvnator/playback/util';
import { isReconnectableMpegTsFailure } from './mpegts-live-reconnect-policy';
import {
    VjsMpegTsLiveRecovery,
    type VjsMpegTsLiveRecoveryHost,
} from './vjs-mpegts-live-recovery';

const EARLY_EOF = evidence(MpegTsPlaybackFailure.TruncatedStream);

describe('isReconnectableMpegTsFailure', () => {
    it.each([
        [MpegTsPlaybackFailure.TruncatedStream, undefined, true],
        [MpegTsPlaybackFailure.Network, undefined, true],
        [MpegTsPlaybackFailure.Timeout, undefined, true],
        [MpegTsPlaybackFailure.Http, 503, true],
        [MpegTsPlaybackFailure.Http, 429, true],
        [MpegTsPlaybackFailure.Http, 401, false],
        [MpegTsPlaybackFailure.Http, 403, false],
        [MpegTsPlaybackFailure.Http, 404, false],
        [MpegTsPlaybackFailure.Http, undefined, false],
        [MpegTsPlaybackFailure.Format, undefined, false],
        [MpegTsPlaybackFailure.Codec, undefined, false],
        [MpegTsPlaybackFailure.MediaSource, undefined, false],
        [MpegTsPlaybackFailure.Unknown, undefined, false],
    ])('%s (HTTP %s) -> %s', (failure, httpStatus, expected) => {
        expect(
            isReconnectableMpegTsFailure(evidence(failure, httpStatus))
        ).toBe(expected);
    });
});

describe('VjsMpegTsLiveRecovery', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('recreates the engine after 1 s and clears the notice once playing', () => {
        const { recovery, host } = create();

        expect(recovery.handleError(EARLY_EOF)).toBe(true);
        expect(host.setReconnecting).toHaveBeenLastCalledWith(true);
        jest.advanceTimersByTime(999);
        expect(host.recreateEngine).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(host.recreateEngine).toHaveBeenCalledTimes(1);

        recovery.notifyPlaying();
        expect(host.setReconnecting).toHaveBeenLastCalledWith(false);
        jest.advanceTimersByTime(60_000);
        expect(host.fail).not.toHaveBeenCalled();
    });

    it('succeeds on the second attempt after waiting 1 s then 2 s', () => {
        const { recovery, host } = create();

        recovery.handleError(EARLY_EOF);
        jest.advanceTimersByTime(1000);
        expect(recovery.handleError(EARLY_EOF)).toBe(true);
        jest.advanceTimersByTime(1999);
        expect(host.recreateEngine).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1);
        expect(host.recreateEngine).toHaveBeenCalledTimes(2);

        recovery.notifyPlaying();
        expect(host.fail).not.toHaveBeenCalled();
    });

    it('rejects the fourth error so the caller reports the terminal issue', () => {
        const { recovery, host } = create();

        for (const wait of [1000, 2000, 4000]) {
            expect(recovery.handleError(EARLY_EOF)).toBe(true);
            jest.advanceTimersByTime(wait);
        }
        expect(host.recreateEngine).toHaveBeenCalledTimes(3);
        expect(recovery.handleError(EARLY_EOF)).toBe(false);
        expect(host.setReconnecting).toHaveBeenLastCalledWith(false);
    });

    it('fails with the last evidence when an attempt never starts playing', () => {
        const { recovery, host } = create();

        recovery.handleError(EARLY_EOF);
        for (const wait of [1000, 10_000, 2000, 10_000, 4000, 10_000]) {
            jest.advanceTimersByTime(wait);
        }

        expect(host.recreateEngine).toHaveBeenCalledTimes(3);
        expect(host.fail).toHaveBeenCalledTimes(1);
        expect(host.fail).toHaveBeenCalledWith(EARLY_EOF);
        expect(host.setReconnecting).toHaveBeenLastCalledWith(false);
    });

    it('absorbs a duplicate error while waiting without a second timer', () => {
        const { recovery, host } = create();

        recovery.handleError(EARLY_EOF);
        expect(recovery.handleError(EARLY_EOF)).toBe(true);
        expect(recovery.handleError(EARLY_EOF)).toBe(true);
        jest.advanceTimersByTime(1000);

        expect(host.recreateEngine).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1000);
        expect(host.recreateEngine).toHaveBeenCalledTimes(1);
    });

    it('restores the budget only after 30 s of stable playback', () => {
        const { recovery, host } = create();

        for (const wait of [1000, 2000]) {
            recovery.handleError(EARLY_EOF);
            jest.advanceTimersByTime(wait);
            recovery.notifyPlaying();
            jest.advanceTimersByTime(5000);
        }
        recovery.handleError(EARLY_EOF);
        jest.advanceTimersByTime(4000);
        recovery.notifyPlaying();
        jest.advanceTimersByTime(30_000);

        recovery.handleError(EARLY_EOF);
        jest.advanceTimersByTime(1000);
        expect(host.recreateEngine).toHaveBeenCalledTimes(4);
        expect(host.fail).not.toHaveBeenCalled();
    });

    it('reset invalidates the pending recreation', () => {
        const { recovery, host } = create();

        recovery.handleError(EARLY_EOF);
        recovery.reset();
        jest.advanceTimersByTime(60_000);

        expect(host.recreateEngine).not.toHaveBeenCalled();
        expect(host.fail).not.toHaveBeenCalled();
        expect(host.setReconnecting).toHaveBeenLastCalledWith(false);
    });

    it.each([
        ['not live', { live: false }],
        ['disabled', { enabled: false }],
    ])('does not absorb errors when %s', (_name, options) => {
        const { recovery, host } = create(options);

        expect(recovery.handleError(EARLY_EOF)).toBe(false);
        jest.advanceTimersByTime(10_000);
        expect(host.recreateEngine).not.toHaveBeenCalled();
    });

    it('does not absorb decode or authorization errors', () => {
        const { recovery } = create();

        expect(
            recovery.handleError(evidence(MpegTsPlaybackFailure.Format))
        ).toBe(false);
        expect(
            recovery.handleError(evidence(MpegTsPlaybackFailure.Http, 403))
        ).toBe(false);
    });
});

function create(options: { live?: boolean; enabled?: boolean } = {}) {
    const host = {
        isEnabled: jest.fn(() => options.enabled ?? true),
        isLive: jest.fn(() => options.live ?? true),
        recreateEngine: jest.fn(),
        setReconnecting: jest.fn(),
        fail: jest.fn(),
    } satisfies VjsMpegTsLiveRecoveryHost;
    return { host, recovery: new VjsMpegTsLiveRecovery(host) };
}

function evidence(
    failure: MpegTsPlaybackEvidence['failure'],
    httpStatus?: number
): MpegTsPlaybackEvidence {
    return {
        engineType: MpegTsPlaybackEngineType.Network,
        engineDetails: MpegTsPlaybackEngineDetails.UnrecoverableEarlyEof,
        disposition: MpegTsPlaybackDisposition.Terminal,
        stage: MpegTsPlaybackStage.Loader,
        failure,
        ...(httpStatus === undefined ? {} : { httpStatus }),
    };
}
