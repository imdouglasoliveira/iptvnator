import { signal } from '@angular/core';
import mpegts from 'mpegts.js';
import {
    InlinePlaybackPlayer,
    type MpegTsPlaybackEvidence,
    type PlaybackDiagnostic,
    classifyMpegTsPlaybackIssue,
    collectPlaybackCodecs,
    createMpegTsPlaybackEvidence,
    createPlaybackSourceMetadata,
    getPlaybackMediaExtensionFromUrl,
} from '@iptvnator/playback/util';
import { type MpegTsLiveReconnectPolicy } from './mpegts-live-reconnect-policy';
import { VjsMpegTsLiveRecovery } from './vjs-mpegts-live-recovery';

interface VjsDurationPlayer {
    duration(value?: number): unknown;
}

export interface VjsMpegTsSessionConfig {
    player: () => VjsDurationPlayer;
    isLive: () => boolean;
    emitPlaybackIssue: (issue: PlaybackDiagnostic) => void;
    /** Overrides the preload kill switch; used by tests. */
    isReconnectEnabled?: () => boolean;
    reconnectPolicy?: MpegTsLiveReconnectPolicy;
}

const VOD_DURATION_EVENTS = [
    'durationchange',
    'loadedmetadata',
    'progress',
    'timeupdate',
    'error',
] as const;

export class VjsMpegTsSession {
    private engine: mpegts.Player | null = null;
    private video: HTMLVideoElement | null = null;
    private errorListener: ((...args: unknown[]) => void) | null = null;
    private url: string | null = null;
    readonly reconnecting = signal(false);
    private readonly recovery: VjsMpegTsLiveRecovery;

    constructor(private readonly config: VjsMpegTsSessionConfig) {
        this.recovery = new VjsMpegTsLiveRecovery(
            {
                isEnabled: () =>
                    config.isReconnectEnabled?.() ??
                    !window.electron?.isMpegTsLiveReconnectDisabled?.(),
                isLive: () => config.isLive(),
                recreateEngine: () => this.recreateEngine(),
                setReconnecting: (value) => this.reconnecting.set(value),
                fail: (evidence) => this.emitIssue(evidence),
            },
            config.reconnectPolicy
        );
    }

    isSupportedSource(url?: string): boolean {
        if (!url) {
            return false;
        }

        const extension = getPlaybackMediaExtensionFromUrl(url);
        return (extension === 'ts' || !extension) && mpegts.isSupported();
    }

    start(url: string, video: HTMLVideoElement): void {
        this.destroy();
        this.startEngine(url, video);
    }

    private recreateEngine(): void {
        const { url, video } = this;
        if (!url || !video) {
            return;
        }
        this.teardownEngine();
        this.startEngine(url, video);
    }

    private emitIssue(evidence: MpegTsPlaybackEvidence): void {
        this.config.emitPlaybackIssue(
            classifyMpegTsPlaybackIssue(
                evidence,
                createPlaybackSourceMetadata({
                    ...collectPlaybackCodecs([this.engine?.mediaInfo ?? {}]),
                    url: this.url ?? '',
                    mimeType: 'video/mp2t',
                    player: InlinePlaybackPlayer.VideoJs,
                })
            )
        );
    }

    private startEngine(url: string, video: HTMLVideoElement): void {
        const isLive = this.config.isLive();
        const engine = mpegts.createPlayer({
            type: 'mpegts',
            isLive,
            url,
        });
        this.engine = engine;
        this.video = video;
        this.url = url;
        this.errorListener = (
            type: unknown,
            details: unknown,
            info: unknown
        ) => {
            this.syncDuration();
            const evidence = createMpegTsPlaybackEvidence(type, details, info);
            if (!this.recovery.handleError(evidence)) {
                this.emitIssue(evidence);
            }
        };

        engine.attachMediaElement(video);
        if (!isLive) {
            this.bindDurationEvents(video);
        } else {
            video.addEventListener('playing', this.handlePlaying);
        }
        engine.on(mpegts.Events.ERROR, this.errorListener);
        engine.load();
        const playResult = engine.play();
        if (playResult) {
            void playResult.catch(() => undefined);
        }
    }

    syncDuration(): void {
        if (this.config.isLive() || !this.video) {
            return;
        }

        const duration =
            this.readLastFinitePositiveEnd(this.video.seekable) ??
            this.readLastFinitePositiveEnd(this.video.buffered);
        if (!duration) {
            return;
        }

        const player = this.config.player();
        if (player.duration() !== duration) {
            player.duration(duration);
        }
    }

    destroy(): void {
        this.recovery.reset();
        this.teardownEngine();
        this.video = null;
        this.url = null;
    }

    private teardownEngine(): void {
        const video = this.video;
        if (video) {
            for (const eventName of VOD_DURATION_EVENTS) {
                video.removeEventListener(eventName, this.scheduleDurationSync);
            }
            video.removeEventListener('playing', this.handlePlaying);
        }

        const engine = this.engine;
        if (!engine) {
            this.errorListener = null;
            return;
        }

        if (this.errorListener) {
            engine.off(mpegts.Events.ERROR, this.errorListener);
        }
        this.errorListener = null;
        engine.pause();
        engine.unload();
        engine.detachMediaElement();
        engine.destroy();
        this.engine = null;
    }

    private readonly handlePlaying = () => this.recovery.notifyPlaying();

    private readonly scheduleDurationSync = () => {
        this.syncDuration();
        this.queueMicrotask(() => this.syncDuration());
    };

    private bindDurationEvents(video: HTMLVideoElement): void {
        for (const eventName of VOD_DURATION_EVENTS) {
            video.addEventListener(eventName, this.scheduleDurationSync);
        }
        this.syncDuration();
    }

    private readLastFinitePositiveEnd(ranges: TimeRanges): number | null {
        for (let index = ranges.length - 1; index >= 0; index -= 1) {
            try {
                const end = ranges.end(index);
                if (Number.isFinite(end) && end > 0) {
                    return end;
                }
            } catch {
                continue;
            }
        }
        return null;
    }

    private queueMicrotask(callback: () => void): void {
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(callback);
            return;
        }
        void Promise.resolve().then(callback);
    }
}
