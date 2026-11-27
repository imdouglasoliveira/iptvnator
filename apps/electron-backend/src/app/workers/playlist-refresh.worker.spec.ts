import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    M3U_CONDITIONAL_REFRESH_KILL_SWITCH,
    PLAYLIST_REFRESH_UNCHANGED_RESULT_TYPE,
    type Playlist,
    type PlaylistRefreshUnchangedResult,
} from '@iptvnator/shared/interfaces';
import { hashPlaylistBody } from '../events/playlist-source';
import type {
    PlaylistRefreshWorkerIncomingMessage,
    PlaylistRefreshWorkerMessage,
    PlaylistRefreshWorkerResponseMessage,
} from './playlist-refresh.worker.types';

const postMessage = jest.fn();
let handleMessage:
    | ((message: PlaylistRefreshWorkerIncomingMessage) => Promise<void>)
    | undefined;

jest.mock('electron', () => {
    throw new Error('electron is unavailable inside worker_threads');
});

jest.mock('worker_threads', () => ({
    workerData: {},
    parentPort: {
        on: (
            _event: string,
            listener: (
                message: PlaylistRefreshWorkerIncomingMessage
            ) => Promise<void>
        ) => {
            handleMessage = listener;
        },
        postMessage: (
            message: PlaylistRefreshWorkerMessage<
                Playlist | PlaylistRefreshUnchangedResult
            >
        ) => postMessage(message),
    },
}));

const ORIGINAL_M3U =
    '#EXTM3U\n#EXTINF:-1 group-title="News",Original UA Channel\nhttps://streams.example.test/original-ua-channel.m3u8\n';
const UPDATED_M3U =
    '#EXTM3U\n#EXTINF:-1 group-title="News",Manual UA Channel\nhttps://streams.example.test/manual-ua-channel.m3u8\n';

interface ProtectedTestServer {
    url: string;
    requests: { headers: IncomingMessage['headers'] }[];
    close: () => Promise<void>;
}

async function startProtectedServer(
    body: string,
    requiredUserAgent: string
): Promise<ProtectedTestServer> {
    const requests: { headers: IncomingMessage['headers'] }[] = [];
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        requests.push({ headers: { ...req.headers } });
        if (req.headers['user-agent'] !== requiredUserAgent) {
            res.writeHead(403);
            res.end('User-Agent required');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(body);
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}/auto-refresh-source.m3u`,
        requests,
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((err) => (err ? reject(err) : resolve()))
            ),
    };
}

function getMessageHandler(): (
    message: PlaylistRefreshWorkerIncomingMessage
) => Promise<void> {
    if (!handleMessage) {
        throw new Error('Expected worker to register a parentPort message handler');
    }
    return handleMessage;
}

function getLastResponse(): PlaylistRefreshWorkerResponseMessage<
    Playlist | PlaylistRefreshUnchangedResult
> {
    const responses = postMessage.mock.calls
        .map(
            ([message]) =>
                message as PlaylistRefreshWorkerMessage<
                    Playlist | PlaylistRefreshUnchangedResult
                >
        )
        .filter(
            (
                message
            ): message is PlaylistRefreshWorkerResponseMessage<
                Playlist | PlaylistRefreshUnchangedResult
            > => message.type === 'response'
        );
    const last = responses[responses.length - 1];
    if (!last) {
        throw new Error('Expected a worker response message');
    }
    return last;
}

describe('playlist-refresh.worker', () => {
    const originalKillSwitch = process.env[M3U_CONDITIONAL_REFRESH_KILL_SWITCH];

    beforeEach(async () => {
        jest.resetModules();
        postMessage.mockReset();
        handleMessage = undefined;
        delete process.env[M3U_CONDITIONAL_REFRESH_KILL_SWITCH];
        await import('./playlist-refresh.worker');
    });

    afterEach(() => {
        if (originalKillSwitch === undefined) {
            delete process.env[M3U_CONDITIONAL_REFRESH_KILL_SWITCH];
        } else {
            process.env[M3U_CONDITIONAL_REFRESH_KILL_SWITCH] =
                originalKillSwitch;
        }
    });

    it('boots without electron and refreshes a User-Agent protected URL when content changes', async () => {
        const userAgent = 'IPTVnator-Test/1.0';
        const server = await startProtectedServer(UPDATED_M3U, userAgent);

        try {
            expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
            expect(handleMessage).toBeDefined();

            await getMessageHandler()({
                type: 'request',
                payload: {
                    operationId: 'op-ua-updated',
                    playlistId: 'pl-ua',
                    title: 'auto-refresh-source.m3u',
                    url: server.url,
                    userAgent,
                },
                conditionalRefresh: {
                    state: {
                        bodySha256: hashPlaylistBody(ORIGINAL_M3U),
                        itemsRevision: 1,
                        checkedAt: '2026-11-27T12:00:00.000Z',
                        nextCheckAt: '2026-11-27T12:00:00.000Z',
                        failures: 0,
                    },
                    forceFullDownload: false,
                },
            });

            const response = getLastResponse();
            expect(response.success).toBe(true);
            expect(response.refreshMeta).toMatchObject({
                unchanged: false,
                bodySha256: hashPlaylistBody(UPDATED_M3U),
                fromNotModified: false,
            });
            expect((response.result as Playlist).playlist.items).toEqual([
                expect.objectContaining({ name: 'Manual UA Channel' }),
            ]);
            expect(server.requests[0].headers['user-agent']).toBe(userAgent);
        } finally {
            await server.close();
        }
    });

    it('returns unchanged when the protected URL returns the same body hash', async () => {
        const userAgent = 'IPTVnator-Test/1.0';
        const server = await startProtectedServer(ORIGINAL_M3U, userAgent);

        try {
            await getMessageHandler()({
                type: 'request',
                payload: {
                    operationId: 'op-ua-unchanged',
                    playlistId: 'pl-ua',
                    title: 'auto-refresh-source.m3u',
                    url: server.url,
                    userAgent,
                },
                conditionalRefresh: {
                    state: {
                        bodySha256: hashPlaylistBody(ORIGINAL_M3U),
                        itemsRevision: 1,
                        checkedAt: '2026-11-27T12:00:00.000Z',
                        nextCheckAt: '2026-11-27T12:00:00.000Z',
                        failures: 0,
                    },
                    forceFullDownload: false,
                },
            });

            const response = getLastResponse();
            expect(response.success).toBe(true);
            expect(response.result).toEqual({
                operationId: 'op-ua-unchanged',
                playlistId: 'pl-ua',
                type: PLAYLIST_REFRESH_UNCHANGED_RESULT_TYPE,
            });
            expect(response.refreshMeta?.unchanged).toBe(true);
        } finally {
            await server.close();
        }
    });

    it('ignores conditional state when the kill switch env var is set', async () => {
        process.env[M3U_CONDITIONAL_REFRESH_KILL_SWITCH] = '1';
        const userAgent = 'IPTVnator-Test/1.0';
        const server = await startProtectedServer(ORIGINAL_M3U, userAgent);

        try {
            await getMessageHandler()({
                type: 'request',
                payload: {
                    operationId: 'op-ua-kill-switch',
                    playlistId: 'pl-ua',
                    title: 'auto-refresh-source.m3u',
                    url: server.url,
                    userAgent,
                },
                conditionalRefresh: {
                    state: {
                        bodySha256: hashPlaylistBody(ORIGINAL_M3U),
                        itemsRevision: 1,
                        checkedAt: '2026-11-27T12:00:00.000Z',
                        nextCheckAt: '2026-11-27T12:00:00.000Z',
                        failures: 0,
                    },
                    forceFullDownload: false,
                },
            });

            const response = getLastResponse();
            expect(response.success).toBe(true);
            expect(response.refreshMeta?.unchanged).toBe(false);
            expect((response.result as Playlist).playlist.items).toEqual([
                expect.objectContaining({ name: 'Original UA Channel' }),
            ]);
        } finally {
            await server.close();
        }
    });
});
