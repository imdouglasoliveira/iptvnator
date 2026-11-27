import { parentPort } from 'worker_threads';
import { parse } from 'iptv-playlist-parser';
import { readFile } from 'node:fs/promises';
import {
    createPlaylistObject,
    getFilenameFromUrl,
} from '@iptvnator/shared/m3u-utils';
import { createPlaylistAgentFactory } from '../util/secure-https';
import {
    M3U_CONDITIONAL_REFRESH_KILL_SWITCH,
    PLAYLIST_REFRESH_UNCHANGED_RESULT_TYPE,
    type Playlist,
    type PlaylistRefreshEvent,
    type PlaylistRefreshPayload,
    type PlaylistRefreshUnchangedResult,
} from '@iptvnator/shared/interfaces';
import type {
    PlaylistRefreshWorkerConditionalContext,
    PlaylistRefreshWorkerIncomingMessage,
    PlaylistRefreshWorkerMessage,
    PlaylistRefreshWorkerMeta,
} from './playlist-refresh.worker.types';
import {
    createInvalidTlsCertificateError,
    getHostnameFromErrorUrl,
    isInvalidTlsCertificateError,
} from '../util/security-errors';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import { applyElectronNetworkDefaults } from '../util/network-defaults';
import {
    hashPlaylistBody,
    PLAYLIST_FETCH_TIMEOUT_MS,
} from '../events/playlist-source';
import {
    armWorkerPerformanceCapture,
    executeWithWorkerPerformanceCapture,
    stampWorkerPerformanceResponsePostedEpoch,
    startWorkerPerformanceCapture,
} from './worker-performance-capture';

type PlaylistRefreshWorkerResult = Playlist | PlaylistRefreshUnchangedResult;

type WorkerExecutionResult = {
    result: PlaylistRefreshWorkerResult;
    refreshMeta?: PlaylistRefreshWorkerMeta;
};

type ActiveRefreshState = {
    cancelled: boolean;
    controller: AbortController;
};

// Worker threads keep their own Node networking defaults; see the helper.
applyElectronNetworkDefaults();

const activeRefreshes = new Map<string, ActiveRefreshState>();

if (!parentPort) {
    throw new Error(
        'Playlist refresh worker must be started with a parent port'
    );
}

function postMessage(
    message: PlaylistRefreshWorkerMessage<PlaylistRefreshWorkerResult>
): void {
    parentPort?.postMessage(message);
}

function readHeaderValue(
    headers: unknown,
    name: string
): string | undefined {
    if (!headers || typeof headers !== 'object') {
        return undefined;
    }
    const direct = Reflect.get(headers, name);
    const getter = Reflect.get(headers, 'get');
    const value =
        direct ??
        (typeof getter === 'function'
            ? Reflect.apply(getter, headers, [name])
            : undefined);
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : undefined;
}

function serializeError(error: unknown) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }

    return {
        message: String(error),
    };
}

function createAbortError(operationId: string): Error {
    const error = new Error(`Playlist refresh "${operationId}" was cancelled`);
    error.name = 'AbortError';
    return error;
}

function emitEvent(
    payload: PlaylistRefreshPayload,
    partial: Omit<PlaylistRefreshEvent, 'operationId' | 'playlistId'>
): void {
    postMessage({
        type: 'event',
        event: {
            operationId: payload.operationId,
            playlistId: payload.playlistId,
            ...partial,
        },
    });
}

function checkpoint(payload: PlaylistRefreshPayload): void {
    const active = activeRefreshes.get(payload.operationId);
    if (active?.cancelled) {
        throw createAbortError(payload.operationId);
    }
}

function releaseActiveRefresh(
    operationId: string,
    activeRefresh: ActiveRefreshState
): void {
    if (activeRefreshes.get(operationId) === activeRefresh) {
        activeRefreshes.delete(operationId);
    }
}

async function fetchPlaylistFromUrl(
    payload: PlaylistRefreshPayload,
    controller: AbortController,
    conditionalRefresh?: PlaylistRefreshWorkerConditionalContext
): Promise<WorkerExecutionResult> {
    emitEvent(payload, { status: 'started', phase: 'fetching' });
    checkpoint(payload);

    const conditionalEnabled =
        process.env[M3U_CONDITIONAL_REFRESH_KILL_SWITCH] !== '1';
    const refreshState = conditionalEnabled
        ? (conditionalRefresh?.state ?? null)
        : null;
    const useValidators = Boolean(
        refreshState && !conditionalRefresh?.forceFullDownload
    );
    const headers: Record<string, string> = {};
    if (payload.userAgent?.trim()) {
        headers['User-Agent'] = payload.userAgent.trim();
    }
    if (useValidators && refreshState?.etag) {
        headers['If-None-Match'] = refreshState.etag;
    }
    if (useValidators && refreshState?.lastModified) {
        headers['If-Modified-Since'] = refreshState.lastModified;
    }

    let result;
    try {
        result = await requestWithValidatedRedirects<string>(
            payload.url!,
            {
                agentFactory: createPlaylistAgentFactory({
                    trustedInsecureTlsHosts: payload.trustedInsecureTlsHosts,
                }),
                method: 'GET',
                ...(Object.keys(headers).length > 0 ? { headers } : {}),
                ...(useValidators ? { acceptNotModified: true } : {}),
                signal: controller.signal,
                timeout: PLAYLIST_FETCH_TIMEOUT_MS,
            },
            { allowPrivateNetworks: true }
        );
    } catch (error) {
        if (isInvalidTlsCertificateError(error)) {
            throw createInvalidTlsCertificateError(
                getHostnameFromErrorUrl(error, payload.url!)
            );
        }
        throw error;
    }

    checkpoint(payload);
    const etag = readHeaderValue(result.headers, 'etag') ?? refreshState?.etag;
    const lastModified =
        readHeaderValue(result.headers, 'last-modified') ??
        refreshState?.lastModified;

    if (result.status === 304) {
        emitEvent(payload, { status: 'completed', phase: 'fetching' });
        return {
            result: {
                operationId: payload.operationId,
                playlistId: payload.playlistId,
                type: PLAYLIST_REFRESH_UNCHANGED_RESULT_TYPE,
            },
            refreshMeta: {
                unchanged: true,
                etag,
                lastModified,
                bodySha256: refreshState?.bodySha256 ?? '',
                fromNotModified: true,
            },
        };
    }

    const body =
        typeof result.data === 'string'
            ? result.data
            : String(result.data ?? '');
    const bodySha256 = hashPlaylistBody(body);

    if (
        conditionalEnabled &&
        refreshState?.bodySha256 &&
        refreshState.bodySha256 === bodySha256
    ) {
        emitEvent(payload, { status: 'completed', phase: 'fetching' });
        return {
            result: {
                operationId: payload.operationId,
                playlistId: payload.playlistId,
                type: PLAYLIST_REFRESH_UNCHANGED_RESULT_TYPE,
            },
            refreshMeta: {
                unchanged: true,
                etag,
                lastModified,
                bodySha256,
                fromNotModified: false,
            },
        };
    }

    emitEvent(payload, { status: 'progress', phase: 'parsing' });
    const parsedPlaylist = parse(body);
    checkpoint(payload);

    const extractedName =
        payload.url && payload.url.length > 1
            ? getFilenameFromUrl(payload.url)
            : '';
    const playlistName =
        !extractedName || extractedName === 'Untitled playlist'
            ? 'Imported from URL'
            : extractedName;

    return {
        result: createPlaylistObject(
            payload.title || playlistName,
            parsedPlaylist,
            payload.url,
            'URL'
        ),
        refreshMeta: {
            unchanged: false,
            etag,
            lastModified,
            bodySha256,
            fromNotModified: false,
        },
    };
}

async function fetchPlaylistFromFile(
    payload: PlaylistRefreshPayload
): Promise<WorkerExecutionResult> {
    emitEvent(payload, { status: 'started', phase: 'reading-file' });
    checkpoint(payload);
    const fileContent = await readFile(payload.filePath!, 'utf-8');
    checkpoint(payload);

    emitEvent(payload, { status: 'progress', phase: 'parsing' });
    const parsedPlaylist = parse(fileContent);
    checkpoint(payload);

    return {
        result: createPlaylistObject(
            payload.title,
            parsedPlaylist,
            payload.filePath,
            'FILE'
        ),
    };
}

async function executeRefresh(
    payload: PlaylistRefreshPayload,
    activeRefresh: ActiveRefreshState,
    conditionalRefresh?: PlaylistRefreshWorkerConditionalContext
): Promise<WorkerExecutionResult> {
    try {
        const outcome = payload.url
            ? await fetchPlaylistFromUrl(
                  payload,
                  activeRefresh.controller,
                  conditionalRefresh
              )
            : await fetchPlaylistFromFile(payload);

        checkpoint(payload);
        return outcome;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            emitEvent(payload, {
                status: 'cancelled',
                phase: 'parsing',
            });
        } else {
            emitEvent(payload, {
                status: 'error',
                phase: payload.url ? 'fetching' : 'reading-file',
                error: error instanceof Error ? error.message : String(error),
            });
        }
        throw error;
    } finally {
        releaseActiveRefresh(payload.operationId, activeRefresh);
    }
}

parentPort.on(
    'message',
    async (message: PlaylistRefreshWorkerIncomingMessage) => {
        if (message.type === 'cancel') {
            const active = activeRefreshes.get(message.operationId);
            if (active) {
                active.cancelled = true;
                active.controller.abort();
            }
            return;
        }

        const payload = message.payload;
        const activeRefresh: ActiveRefreshState = {
            cancelled: false,
            controller: new AbortController(),
        };
        activeRefreshes.set(payload.operationId, activeRefresh);

        try {
            const performanceCapture = startWorkerPerformanceCapture();
            await armWorkerPerformanceCapture(performanceCapture);
            const execution = await executeWithWorkerPerformanceCapture(
                performanceCapture,
                () =>
                    executeRefresh(
                        payload,
                        activeRefresh,
                        message.conditionalRefresh
                    )
            );

            if (execution.success) {
                postMessage({
                    type: 'response',
                    success: true,
                    result: execution.result.result,
                    ...(execution.result.refreshMeta
                        ? { refreshMeta: execution.result.refreshMeta }
                        : {}),
                    performance: stampWorkerPerformanceResponsePostedEpoch(
                        performanceCapture,
                        execution.performance
                    ),
                });
            } else {
                const error = execution.error;
                postMessage({
                    type: 'response',
                    success: false,
                    error: serializeError(error),
                    performance: stampWorkerPerformanceResponsePostedEpoch(
                        performanceCapture,
                        execution.performance
                    ),
                });
            }
        } finally {
            releaseActiveRefresh(payload.operationId, activeRefresh);
        }
    }
);

postMessage({ type: 'ready' });
