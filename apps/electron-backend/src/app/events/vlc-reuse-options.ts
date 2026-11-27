import type {
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import type { ExternalPlaybackSnapshot } from './external-player-runtime';
import type { VlcRcAddress } from './vlc-rc';

export interface VlcReuseAttemptState {
    contentMutated: boolean;
    teardownUnconfirmed: boolean;
    closeRequested: boolean;
    requestedClose: Promise<void> | null;
}

export interface VlcReuseOptions {
    session: ExternalPlayerSession;
    url: string;
    title: string;
    effectiveUserAgent?: string;
    effectiveReferer?: string;
    effectiveOrigin?: string;
    mergedHeaders: Record<string, string>;
    contentInfo?: PlayerContentInfo;
    startTime?: number;
    continuationOf?: string;
    state: VlcReuseAttemptState;
    startPositionPolling: (
        port: VlcRcAddress,
        contentInfo: PlayerContentInfo,
        sessionId: string,
        onSnapshot?: (snapshot: ExternalPlaybackSnapshot) => void,
        onStopped?: () => void
    ) => void;
    stopPositionPolling: (sessionId: string) => void;
}
