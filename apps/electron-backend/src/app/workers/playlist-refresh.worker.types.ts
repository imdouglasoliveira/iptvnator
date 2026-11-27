import type {
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
} from '@iptvnator/shared/interfaces';
import type { M3uRefreshState } from '../events/m3u-refresh-state';
import type { WorkerPerformanceCaptureResult } from './worker-performance-capture';

export interface PlaylistRefreshWorkerConditionalContext {
    state: M3uRefreshState | null;
    forceFullDownload: boolean;
}

export interface PlaylistRefreshWorkerMeta {
    unchanged: boolean;
    etag?: string;
    lastModified?: string;
    bodySha256: string;
    fromNotModified: boolean;
}

export interface PlaylistRefreshWorkerRequestMessage {
    type: 'request';
    payload: PlaylistRefreshPayload;
    conditionalRefresh?: PlaylistRefreshWorkerConditionalContext;
}

export interface PlaylistRefreshWorkerCancelMessage {
    type: 'cancel';
    operationId: string;
}

export interface PlaylistRefreshWorkerReadyMessage {
    type: 'ready';
}

export interface PlaylistRefreshWorkerEventMessage {
    type: 'event';
    event: PlaylistRefreshEvent;
}

export interface PlaylistRefreshWorkerResponseMessage<TResult = unknown> {
    type: 'response';
    success: boolean;
    result?: TResult;
    refreshMeta?: PlaylistRefreshWorkerMeta;
    error?: {
        name?: string;
        message: string;
        stack?: string;
    };
    performance?: WorkerPerformanceCaptureResult;
}

export type PlaylistRefreshWorkerIncomingMessage =
    | PlaylistRefreshWorkerRequestMessage
    | PlaylistRefreshWorkerCancelMessage;

export type PlaylistRefreshWorkerMessage<TResult = unknown> =
    | PlaylistRefreshWorkerReadyMessage
    | PlaylistRefreshWorkerEventMessage
    | PlaylistRefreshWorkerResponseMessage<TResult>;
