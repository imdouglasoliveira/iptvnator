import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    buildM3uRefreshStateKey,
    computeFailureBackoffMs,
    isConditionalRefreshEnabled,
    isFullDownloadDue,
    isRefreshDeferred,
    prepareConditionalRefresh,
    recordConditionalRefreshFailure,
    recordConditionalRefreshSuccess,
    setConditionalRefreshSettingEnabled,
    type M3uRefreshState,
    type M3uRefreshStateStore,
} from './m3u-refresh-state';
import {
    fetchPlaylistFromUrlConditional,
    hashPlaylistBody,
} from './playlist-source';

const mockParse = jest.fn();

jest.mock('iptv-playlist-parser', () => {
    const actual = jest.requireActual<typeof import('iptv-playlist-parser')>(
        'iptv-playlist-parser'
    );
    return {
        ...actual,
        parse: (...args: Parameters<typeof actual.parse>) => {
            mockParse(...args);
            return actual.parse(...args);
        },
    };
});

const PLAYLIST_BODY_V1 =
    '#EXTM3U\n#EXTINF:-1 group-title="News",Channel One\nhttps://streams.example.test/one.m3u8\n';
const PLAYLIST_BODY_V2 =
    '#EXTM3U\n#EXTINF:-1 group-title="News",Channel Two\nhttps://streams.example.test/two.m3u8\n';

interface LocalTestServer {
    url: string;
    requests: { headers: IncomingMessage['headers'] }[];
    close: () => Promise<void>;
}

async function startLocalServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<LocalTestServer> {
    const requests: { headers: IncomingMessage['headers'] }[] = [];
    const server = createServer((req, res) => {
        requests.push({ headers: { ...req.headers } });
        handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}/list.m3u`,
        requests,
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((err) => (err ? reject(err) : resolve()))
            ),
    };
}

function createMemoryStore(): M3uRefreshStateStore & {
    entries: Map<string, string>;
} {
    const entries = new Map<string, string>();
    return {
        entries,
        get: async (key) => entries.get(key) ?? null,
        set: async (key, value) => {
            entries.set(key, value);
        },
    };
}

describe('m3u-refresh-state and conditional refresh', () => {
    const KILL_SWITCH = 'IPTVNATOR_DISABLE_CONDITIONAL_REFRESH';
    const originalKillSwitch = process.env[KILL_SWITCH];
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        delete process.env[KILL_SWITCH];
        setConditionalRefreshSettingEnabled(true);
        mockParse.mockClear();
        logSpy = jest.spyOn(console, 'log').mockImplementation();
        warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        errorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        if (originalKillSwitch === undefined) {
            delete process.env[KILL_SWITCH];
        } else {
            process.env[KILL_SWITCH] = originalKillSwitch;
        }
        setConditionalRefreshSettingEnabled(true);
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('returns unchanged with 0 parses and 0 writes on HTTP 304', async () => {
        const etag = '"secret-etag-token-123"';
        const lastModified = 'Wed, 21 Oct 2026 07:28:00 GMT';
        const server = await startLocalServer((req, res) => {
            if (req.headers['if-none-match'] === etag) {
                res.writeHead(304, { ETag: etag, 'Last-Modified': lastModified });
                res.end();
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'audio/x-mpegurl',
                ETag: etag,
                'Last-Modified': lastModified,
            });
            res.end(PLAYLIST_BODY_V1);
        });

        try {
            const store = createMemoryStore();
            const playlistId = 'pl-304';
            const now = Date.parse('2026-11-27T12:00:00.000Z');

            const firstPrep = await prepareConditionalRefresh(playlistId, 1, {
                store,
                now,
            });
            const first = await fetchPlaylistFromUrlConditional(
                server.url,
                'Synthetic',
                {
                    refreshState: firstPrep.state,
                    forceFullDownload: firstPrep.forceFullDownload,
                }
            );
            expect(first.status).toBe('updated');
            expect(mockParse).toHaveBeenCalledTimes(1);

            await recordConditionalRefreshSuccess(playlistId, firstPrep.state, first, 1, {
                store,
                now,
            });
            mockParse.mockClear();

            const secondPrep = await prepareConditionalRefresh(playlistId, 1, {
                store,
                now: now + 60_000,
            });
            expect(secondPrep.state?.etag).toBe(etag);
            expect(secondPrep.state?.lastModified).toBe(lastModified);

            const second = await fetchPlaylistFromUrlConditional(
                server.url,
                'Synthetic',
                {
                    refreshState: secondPrep.state,
                    forceFullDownload: secondPrep.forceFullDownload,
                }
            );

            expect(second.status).toBe('unchanged');
            expect(mockParse).toHaveBeenCalledTimes(0);
            expect(server.requests[1].headers['if-none-match']).toBe(etag);
            expect(server.requests[1].headers['if-modified-since']).toBe(
                lastModified
            );

            const allLogs = [
                ...logSpy.mock.calls,
                ...warnSpy.mock.calls,
                ...errorSpy.mock.calls,
            ]
                .flat()
                .map(String)
                .join('\n');
            expect(allLogs).not.toContain('secret-etag-token-123');
        } finally {
            await server.close();
        }
    });

    it('returns unchanged with 0 parses when server returns 200 with identical body hash', async () => {
        const server = await startLocalServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
            res.end(PLAYLIST_BODY_V1);
        });

        try {
            const store = createMemoryStore();
            const playlistId = 'pl-same-hash';
            const now = Date.parse('2026-11-27T12:00:00.000Z');

            const first = await fetchPlaylistFromUrlConditional(
                server.url,
                'Synthetic'
            );
            expect(first.status).toBe('updated');
            expect(mockParse).toHaveBeenCalledTimes(1);

            await recordConditionalRefreshSuccess(playlistId, null, first, 1, {
                store,
                now,
            });
            mockParse.mockClear();

            const secondPrep = await prepareConditionalRefresh(playlistId, 1, {
                store,
                now: now + 60_000,
            });
            const second = await fetchPlaylistFromUrlConditional(
                server.url,
                'Synthetic',
                {
                    refreshState: secondPrep.state,
                    forceFullDownload: secondPrep.forceFullDownload,
                }
            );

            expect(second.status).toBe('unchanged');
            expect(mockParse).toHaveBeenCalledTimes(0);
        } finally {
            await server.close();
        }
    });

    it('parses once and returns updated when server returns a different body', async () => {
        let body = PLAYLIST_BODY_V1;
        const server = await startLocalServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
            res.end(body);
        });

        try {
            const store = createMemoryStore();
            const playlistId = 'pl-changed';
            const now = Date.parse('2026-11-27T12:00:00.000Z');

            const first = await fetchPlaylistFromUrlConditional(
                server.url,
                'Synthetic'
            );
            await recordConditionalRefreshSuccess(playlistId, null, first, 1, {
                store,
                now,
            });
            mockParse.mockClear();

            body = PLAYLIST_BODY_V2;
            const secondPrep = await prepareConditionalRefresh(playlistId, 1, {
                store,
                now: now + 60_000,
            });
            const second = await fetchPlaylistFromUrlConditional(
                server.url,
                'Synthetic',
                {
                    refreshState: secondPrep.state,
                    forceFullDownload: secondPrep.forceFullDownload,
                }
            );

            expect(second.status).toBe('updated');
            expect(mockParse).toHaveBeenCalledTimes(1);
            expect(second.bodySha256).toBe(hashPlaylistBody(PLAYLIST_BODY_V2));
        } finally {
            await server.close();
        }
    });

    it('discards stored state when itemsRevision diverged after another update path', async () => {
        const etag = '"v1-etag"';
        const server = await startLocalServer((req, res) => {
            if (req.headers['if-none-match'] === etag) {
                res.writeHead(304);
                res.end();
                return;
            }
            res.writeHead(200, { ETag: etag });
            res.end(PLAYLIST_BODY_V1);
        });

        try {
            const store = createMemoryStore();
            const playlistId = 'pl-diverged';
            const now = Date.parse('2026-11-27T12:00:00.000Z');
            const staleState: M3uRefreshState = {
                etag,
                bodySha256: hashPlaylistBody(PLAYLIST_BODY_V1),
                itemsRevision: 1,
                checkedAt: new Date(now).toISOString(),
                nextCheckAt: new Date(now).toISOString(),
                failures: 0,
            };
            await store.set(
                buildM3uRefreshStateKey(playlistId),
                JSON.stringify(staleState)
            );

            const prep = await prepareConditionalRefresh(playlistId, 2, {
                store,
                now: now + 1000,
            });
            expect(prep.state).toBeNull();

            const result = await fetchPlaylistFromUrlConditional(
                server.url,
                'Synthetic',
                {
                    refreshState: prep.state,
                    forceFullDownload: prep.forceFullDownload,
                }
            );
            expect(server.requests[0].headers['if-none-match']).toBeUndefined();
            expect(result.status).toBe('updated');
            expect(mockParse).toHaveBeenCalledTimes(1);
        } finally {
            await server.close();
        }
    });

    it('sets nextCheckAt 180s after first failure and doubles up to 24h', async () => {
        const store = createMemoryStore();
        const playlistId = 'pl-fail';
        const now = Date.parse('2026-11-27T12:00:00.000Z');

        const firstFailure = await recordConditionalRefreshFailure(
            playlistId,
            null,
            1,
            { store, now }
        );
        expect(firstFailure.failures).toBe(1);
        expect(firstFailure.nextCheckAt).toBe(
            new Date(now + 180_000).toISOString()
        );
        expect(isRefreshDeferred(firstFailure, now + 60_000)).toBe(true);
        expect(isRefreshDeferred(firstFailure, now + 180_000)).toBe(false);

        const secondFailure = await recordConditionalRefreshFailure(
            playlistId,
            firstFailure,
            1,
            { store, now }
        );
        expect(secondFailure.failures).toBe(2);
        expect(secondFailure.nextCheckAt).toBe(
            new Date(now + 360_000).toISOString()
        );

        expect(computeFailureBackoffMs(20)).toBe(24 * 60 * 60 * 1000);
    });

    it('forces a full download without conditional headers after 7 days', async () => {
        const etag = '"old-etag"';
        const server = await startLocalServer((_req, res) => {
            res.writeHead(200, { ETag: etag });
            res.end(PLAYLIST_BODY_V1);
        });

        try {
            const store = createMemoryStore();
            const playlistId = 'pl-7d';
            const eightDaysAgo = Date.parse('2026-11-19T12:00:00.000Z');
            const now = Date.parse('2026-11-27T12:00:00.000Z');
            const oldState: M3uRefreshState = {
                etag,
                bodySha256: hashPlaylistBody(PLAYLIST_BODY_V1),
                itemsRevision: 1,
                checkedAt: new Date(eightDaysAgo).toISOString(),
                lastFullCheckAt: new Date(eightDaysAgo).toISOString(),
                nextCheckAt: new Date(eightDaysAgo).toISOString(),
                failures: 0,
            };
            await store.set(
                buildM3uRefreshStateKey(playlistId),
                JSON.stringify(oldState)
            );

            expect(isFullDownloadDue(oldState, now)).toBe(true);
            const prep = await prepareConditionalRefresh(playlistId, 1, {
                store,
                now,
            });
            expect(prep.forceFullDownload).toBe(true);

            const result = await fetchPlaylistFromUrlConditional(
                server.url,
                'Synthetic',
                {
                    refreshState: prep.state,
                    forceFullDownload: prep.forceFullDownload,
                }
            );
            expect(server.requests[0].headers['if-none-match']).toBeUndefined();
            expect(result.status).toBe('unchanged');
            expect(mockParse).toHaveBeenCalledTimes(0);
        } finally {
            await server.close();
        }
    });

    it('disables conditional refresh when kill switch env var is set', async () => {
        process.env[KILL_SWITCH] = '1';
        expect(isConditionalRefreshEnabled()).toBe(false);

        const store = createMemoryStore();
        await store.set(
            buildM3uRefreshStateKey('pl-ks'),
            JSON.stringify({
                etag: '"e1"',
                bodySha256: hashPlaylistBody(PLAYLIST_BODY_V1),
                itemsRevision: 1,
                checkedAt: '2026-11-27T12:00:00.000Z',
                nextCheckAt: '2026-11-27T12:00:00.000Z',
                failures: 0,
            })
        );

        const prep = await prepareConditionalRefresh('pl-ks', 1, { store });
        expect(prep.enabled).toBe(false);
        expect(prep.state).toBeNull();
    });

    it('disables conditional refresh when settings mirror is turned off', async () => {
        setConditionalRefreshSettingEnabled(false);
        expect(isConditionalRefreshEnabled()).toBe(false);

        const store = createMemoryStore();
        const prep = await prepareConditionalRefresh('pl-setting-off', 1, {
            store,
        });
        expect(prep.enabled).toBe(false);
        expect(prep.state).toBeNull();
    });
});
