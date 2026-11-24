import type { MpegTsPlaybackEvidence } from '@iptvnator/playback/util';
import {
    DEFAULT_MPEGTS_LIVE_RECONNECT_POLICY,
    type MpegTsLiveReconnectPolicy,
    isReconnectableMpegTsFailure,
} from './mpegts-live-reconnect-policy';

export interface VjsMpegTsLiveRecoveryHost {
    isEnabled(): boolean;
    isLive(): boolean;
    /** Replace the engine on the same channel; the generation is already checked. */
    recreateEngine(): void;
    setReconnecting(reconnecting: boolean): void;
    /** Budget exhausted: surface the last evidence as the terminal diagnostic. */
    fail(evidence: MpegTsPlaybackEvidence): void;
}

type Phase = 'idle' | 'waiting' | 'attempting';

/** One recovery at a time; reset() invalidates every pending callback. */
export class VjsMpegTsLiveRecovery {
    private generation = 0;
    private attempts = 0;
    private phase: Phase = 'idle';
    private timer: ReturnType<typeof setTimeout> | undefined;
    private stableTimer: ReturnType<typeof setTimeout> | undefined;
    private lastEvidence: MpegTsPlaybackEvidence | null = null;

    constructor(
        private readonly host: VjsMpegTsLiveRecoveryHost,
        private readonly policy: MpegTsLiveReconnectPolicy = DEFAULT_MPEGTS_LIVE_RECONNECT_POLICY
    ) {}

    /** True when the error was absorbed; false means the caller reports it. */
    handleError(evidence: MpegTsPlaybackEvidence): boolean {
        if (
            !this.host.isEnabled() ||
            !this.host.isLive() ||
            !isReconnectableMpegTsFailure(evidence)
        ) {
            return false;
        }
        if (this.phase === 'waiting') {
            return true;
        }
        this.lastEvidence = evidence;
        return this.schedule();
    }

    notifyPlaying(): void {
        if (this.attempts === 0) {
            return;
        }
        if (this.phase === 'attempting') {
            this.clearTimer();
            this.phase = 'idle';
            this.host.setReconnecting(false);
        }
        if (this.phase === 'idle' && this.stableTimer === undefined) {
            const generation = this.generation;
            this.stableTimer = setTimeout(() => {
                if (generation === this.generation) {
                    this.stableTimer = undefined;
                    this.attempts = 0;
                }
            }, this.policy.stableWindowMs);
        }
    }

    reset(): void {
        this.generation += 1;
        this.clearTimer();
        this.clearStableTimer();
        this.attempts = 0;
        this.phase = 'idle';
        this.lastEvidence = null;
        this.host.setReconnecting(false);
    }

    private schedule(): boolean {
        this.clearTimer();
        this.clearStableTimer();
        const delay = this.policy.delaysMs[this.attempts];
        if (delay === undefined) {
            this.phase = 'idle';
            this.host.setReconnecting(false);
            return false;
        }
        this.attempts += 1;
        this.phase = 'waiting';
        this.host.setReconnecting(true);
        const generation = this.generation;
        this.timer = setTimeout(() => {
            if (generation !== this.generation) {
                return;
            }
            this.phase = 'attempting';
            this.host.recreateEngine();
            if (generation !== this.generation || this.phase !== 'attempting') {
                return;
            }
            this.timer = setTimeout(() => {
                if (generation !== this.generation) {
                    return;
                }
                const evidence = this.lastEvidence;
                if (
                    evidence &&
                    !this.schedule() &&
                    generation === this.generation
                ) {
                    this.host.fail(evidence);
                }
            }, this.policy.attemptTimeoutMs);
        }, delay);
        return true;
    }

    private clearTimer(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private clearStableTimer(): void {
        if (this.stableTimer !== undefined) {
            clearTimeout(this.stableTimer);
            this.stableTimer = undefined;
        }
    }
}
