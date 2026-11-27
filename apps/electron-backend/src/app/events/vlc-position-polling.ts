import {
    EXTERNAL_PLAYBACK_ENDED,
    type PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import App from '../app';
import { createExternalPlaybackEndDetector } from './external-playback-ended';
import { ExternalPlayerPositionPollers } from './external-player-position-pollers';
import {
    externalPlayerSessions,
    sendPlaybackActivityUpdate,
    sendPlaybackPositionUpdate,
    type ExternalPlaybackSnapshot,
} from './external-player-runtime';
import {
    getVlcPlaybackSnapshot,
    getVlcPlaybackState,
    type VlcRcAddress,
} from './vlc-rc';
import type { VlcReusableProcess } from './vlc-reusable-process';

const pollers = new ExternalPlayerPositionPollers();
let finished: { sessionId: string; owner: VlcReusableProcess } | undefined;

export function takeVlcContinuation(
    sessionId: string,
    next: PlayerContentInfo | undefined
): VlcReusableProcess | undefined {
    if (finished?.sessionId !== sessionId || !next?.m3uSeries) return;
    const previous = externalPlayerSessions.getSession(sessionId)?.contentInfo;
    if (
        !previous ||
        externalPlayerSessions.getActiveSessionId() !== sessionId ||
        externalPlayerSessions.isCloseRequested(sessionId) ||
        previous.playlistId !== next.playlistId ||
        previous.seriesXtreamId !== next.seriesXtreamId ||
        next.contentType !== 'episode' ||
        finished.owner.currentSessionId() !== sessionId
    ) {
        return;
    }
    const { owner } = finished;
    finished = undefined;
    return owner;
}

export function stopVlcPositionPolling(sessionId?: string): void {
    if (!sessionId || finished?.sessionId === sessionId) finished = undefined;
    pollers.stop(sessionId);
}

export function startVlcPositionPolling(
    owner: VlcReusableProcess,
    port: VlcRcAddress,
    contentInfo: PlayerContentInfo,
    sessionId: string,
    onSnapshot?: (snapshot: ExternalPlaybackSnapshot) => void,
    onStopped?: () => void
): void {
    const trackEnd =
        contentInfo.m3uSeries && contentInfo.contentType === 'episode';
    const detectEnd = createExternalPlaybackEndDetector(
        sessionId,
        contentInfo,
        (event) => {
            finished = { sessionId, owner };
            externalPlayerSessions.updateSession(sessionId, {
                playbackIdle: true,
            });
            if (App.mainWindow && !App.mainWindow.isDestroyed())
                App.mainWindow.webContents.send(EXTERNAL_PLAYBACK_ENDED, event);
        }
    );
    let polling = false;

    pollers.start(sessionId, 1500, 2000, async (isCurrent) => {
        if (trackEnd && polling) return;
        polling = true;
        const primary = pollers.isPrimary(sessionId);
        const ownsReply = () =>
            isCurrent() && primary === pollers.isPrimary(sessionId);
        try {
            const snapshot = await getVlcPlaybackSnapshot(port);
            if (!ownsReply()) return;
            const state =
                !snapshot || (trackEnd && primary)
                    ? await getVlcPlaybackState(port)
                    : null;
            if (!ownsReply()) return;
            const stopped = state === 'stopped';
            if (
                primary &&
                trackEnd &&
                externalPlayerSessions.getActiveSessionId() === sessionId &&
                !externalPlayerSessions.isCloseRequested(sessionId) &&
                detectEnd(state, snapshot)
            ) {
                pollers.stop(sessionId);
                return;
            }
            if (snapshot && (!stopped || snapshot.positionSeconds > 0)) {
                if (primary) {
                    onSnapshot?.(snapshot);
                    sendPlaybackPositionUpdate(
                        sessionId,
                        contentInfo,
                        snapshot
                    );
                } else {
                    sendPlaybackActivityUpdate(
                        sessionId,
                        contentInfo,
                        snapshot.positionSeconds
                    );
                }
            }
            if (stopped) {
                if (primary) onStopped?.();
                stopVlcPositionPolling(sessionId);
            }
        } catch {
            if (ownsReply()) stopVlcPositionPolling(sessionId);
        } finally {
            polling = false;
        }
    });
}
