import { once } from 'node:events';
import { createServer, type Server, type ServerResponse } from 'node:http';

import type { SyntheticM3uFixture } from './synthetic-m3u';

export const SYNTHETIC_M3U_RESOURCE_PATH = '/synthetic-performance.m3u';

type PlaylistBody = Pick<SyntheticM3uFixture, 'body' | 'bytes'>;

export interface SyntheticM3uServer {
    readonly origin: string;
    readonly resourceUrl: string;
    close(): Promise<void>;
    prime(): Promise<void>;
    requestCount(): number;
}

export async function startSyntheticM3uServer(
    fixture: PlaylistBody | ((origin: string) => PlaylistBody),
    videos: ReadonlyMap<string, Buffer> = new Map()
): Promise<SyntheticM3uServer> {
    let successfulRequestCount = 0;
    const server = createServer();
    server.listen({
        exclusive: true,
        host: '127.0.0.1',
        port: 0,
    });
    try {
        await once(server, 'listening');
    } catch (error: unknown) {
        await closeServer(server).catch(() => undefined);
        throw error;
    }

    const address = server.address();
    if (
        address === null ||
        typeof address === 'string' ||
        address.address !== '127.0.0.1' ||
        !Number.isSafeInteger(address.port) ||
        address.port <= 0
    ) {
        await closeServer(server);
        throw new Error(
            'Synthetic M3U server did not bind exact IPv4 loopback'
        );
    }

    const origin = `http://127.0.0.1:${address.port}`;
    const resourceUrl = `${origin}${SYNTHETIC_M3U_RESOURCE_PATH}`;
    let playlist: PlaylistBody;
    try {
        playlist = typeof fixture === 'function' ? fixture(origin) : fixture;
    } catch (error: unknown) {
        await closeServer(server);
        throw error;
    }

    server.on('request', (request, response) => {
        const { pathname, search } = new URL(request.url ?? '/', origin);
        if (request.method === 'GET' && !search) {
            if (pathname === SYNTHETIC_M3U_RESOURCE_PATH) {
                successfulRequestCount += 1;
                response.writeHead(200, {
                    'Cache-Control': 'no-store',
                    'Content-Length': String(playlist.bytes),
                    'Content-Type':
                        'application/vnd.apple.mpegurl; charset=utf-8',
                });
                response.end(playlist.body);
                return;
            }

            const video = videos.get(pathname);
            if (video) {
                sendVideo(response, video, request.headers.range);
                return;
            }
        }

        response.writeHead(404, {
            'Content-Length': '0',
            'Content-Type': 'text/plain; charset=utf-8',
        });
        response.end();
    });

    let closePromise: Promise<void> | null = null;

    return Object.freeze({
        origin,
        resourceUrl,
        close: () => {
            closePromise ??= closeServer(server);
            return closePromise;
        },
        prime: async () => {
            if (closePromise !== null) {
                throw new Error('Synthetic M3U server is closed');
            }
            const response = await fetch(resourceUrl);
            const body = await response.arrayBuffer();
            if (
                response.status !== 200 ||
                Number(response.headers.get('content-length')) !==
                    playlist.bytes ||
                body.byteLength !== playlist.bytes
            ) {
                throw new Error(
                    'Synthetic M3U server priming response was invalid'
                );
            }
        },
        requestCount: () => successfulRequestCount,
    });
}

function sendVideo(
    response: ServerResponse,
    video: Buffer,
    rangeHeader: string | undefined
): void {
    const headers = {
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'video/webm',
    };
    if (rangeHeader === undefined) {
        response.writeHead(200, { ...headers, 'Content-Length': video.length });
        response.end(video);
        return;
    }

    const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    const last = video.length - 1;
    const start = range?.[1]
        ? Number(range[1])
        : Math.max(0, video.length - Number(range?.[2]));
    const end =
        range?.[1] && range[2] ? Math.min(Number(range[2]), last) : last;
    if (!range || (!range[1] && !range[2]) || start > end) {
        response.writeHead(416, { 'Content-Range': `bytes */${video.length}` });
        response.end();
        return;
    }

    response.writeHead(206, {
        ...headers,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${video.length}`,
    });
    response.end(video.subarray(start, end + 1));
}

async function closeServer(server: Server): Promise<void> {
    if (!server.listening) {
        return;
    }
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
            if (error) {
                rejectPromise(error);
                return;
            }
            resolvePromise();
        });
    });
}
