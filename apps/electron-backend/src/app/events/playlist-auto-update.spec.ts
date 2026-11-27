import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    AUTO_UPDATE_CONCURRENCY,
    autoUpdatePlaylists,
} from './playlist-auto-update';

const mockFetchPlaylistFromFile = jest.fn();
const mockFetchPlaylistFromUrlConditional = jest.fn();
const mockPrepareConditionalRefresh = jest.fn();
const mockRecordConditionalRefreshSuccess = jest.fn();
const mockRecordConditionalRefreshFailure = jest.fn();

jest.mock('./playlist-source', () => ({
    ...jest.requireActual('./playlist-source'),
    fetchPlaylistFromFile: (...args: unknown[]) =>
        mockFetchPlaylistFromFile(...args),
    fetchPlaylistFromUrlConditional: (...args: unknown[]) =>
        mockFetchPlaylistFromUrlConditional(...args),
}));

jest.mock('./m3u-refresh-state', () => ({
    ...jest.requireActual('./m3u-refresh-state'),
    prepareConditionalRefresh: (...args: unknown[]) =>
        mockPrepareConditionalRefresh(...args),
    recordConditionalRefreshSuccess: (...args: unknown[]) =>
        mockRecordConditionalRefreshSuccess(...args),
    recordConditionalRefreshFailure: (...args: unknown[]) =>
        mockRecordConditionalRefreshFailure(...args),
}));

function createPlaylist(overrides: Partial<Playlist> = {}): Playlist {
    return {
        _id: 'playlist-1',
        autoRefresh: true,
        count: 1,
        favorites: [],
        filename: 'Playlist',
        importDate: '2026-06-02T00:00:00.000Z',
        lastUsage: '2026-06-02T00:00:00.000Z',
        playlist: { items: [] },
        title: 'Playlist',
        ...overrides,
    };
}

function createUrlPlaylist(id: string, url: string): Playlist {
    return createPlaylist({ _id: id, title: id, url });
}

/** Lets every pending promise chain settle without advancing timers. */
function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/** A promise that never settles on its own, plus its resolver. */
function createPendingFetch(): {
    promise: Promise<Playlist>;
    resolve: (playlist: Playlist) => void;
} {
    let resolve!: (playlist: Playlist) => void;
    const promise = new Promise<Playlist>((resolvePromise) => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

describe('autoUpdatePlaylists', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        mockFetchPlaylistFromFile.mockReset();
        mockFetchPlaylistFromUrlConditional.mockReset();
        mockPrepareConditionalRefresh.mockReset().mockResolvedValue({
            enabled: true,
            forceFullDownload: false,
            state: null,
        });
        mockRecordConditionalRefreshSuccess
            .mockReset()
            .mockResolvedValue(undefined);
        mockRecordConditionalRefreshFailure
            .mockReset()
            .mockResolvedValue(undefined);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    it('refreshes the remaining playlists while an unresponsive source is still pending', async () => {
        const unresponsive = createPendingFetch();
        mockFetchPlaylistFromUrlConditional.mockImplementation((url: string) =>
            url === 'https://unresponsive.test/list.m3u'
                ? unresponsive.promise.then((playlist) => ({
                      status: 'updated',
                      playlist,
                      bodySha256: 'hash-slow',
                  }))
                : Promise.resolve({
                      status: 'updated',
                      playlist: createPlaylist({ title: 'Refreshed' }),
                      bodySha256: 'hash-fast',
                  })
        );

        const updatePromise = autoUpdatePlaylists([
            createUrlPlaylist(
                'unresponsive',
                'https://unresponsive.test/list.m3u'
            ),
            createUrlPlaylist('reachable', 'https://reachable.test/list.m3u'),
        ]);

        await flushMicrotasks();

        expect(mockFetchPlaylistFromUrlConditional).toHaveBeenCalledWith(
            'https://reachable.test/list.m3u',
            'reachable',
            expect.objectContaining({
                forceFullDownload: false,
                refreshState: null,
            })
        );

        unresponsive.resolve(createPlaylist({ title: 'Slow but refreshed' }));

        const result = await updatePromise;
        expect(result.playlists).toEqual([
            expect.objectContaining({ _id: 'unresponsive' }),
            expect.objectContaining({ _id: 'reachable' }),
        ]);
        expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
            'updated',
            'updated',
        ]);
    });

    it('keeps the playlists that succeeded when another source fails', async () => {
        mockFetchPlaylistFromUrlConditional.mockImplementation((url: string) =>
            url === 'https://broken.test/list.m3u'
                ? Promise.reject(new Error('timeout of 30000ms exceeded'))
                : Promise.resolve({
                      status: 'updated',
                      playlist: createPlaylist({ title: 'Refreshed' }),
                      bodySha256: 'hash-ok',
                  })
        );

        const result = await autoUpdatePlaylists([
            createUrlPlaylist('broken', 'https://broken.test/list.m3u'),
            createUrlPlaylist('reachable', 'https://reachable.test/list.m3u'),
        ]);

        expect(result.playlists).toEqual([
            expect.objectContaining({ _id: 'reachable' }),
        ]);
        expect(result.outcomes).toEqual([
            { playlistId: 'broken', status: 'failed', title: 'broken' },
            { playlistId: 'reachable', status: 'updated', title: 'reachable' },
        ]);
        expect(mockRecordConditionalRefreshFailure).toHaveBeenCalledWith(
            'broken',
            null,
            undefined
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to update playlist "broken":',
            expect.objectContaining({
                message: 'timeout of 30000ms exceeded',
            })
        );
    });

    it('never runs more refreshes at once than the configured concurrency', async () => {
        const pendingFetches = Array.from(
            { length: AUTO_UPDATE_CONCURRENCY + 2 },
            createPendingFetch
        );
        let startedFetches = 0;
        mockFetchPlaylistFromUrlConditional.mockImplementation(() =>
            pendingFetches[startedFetches++].promise.then((playlist) => ({
                status: 'updated',
                playlist,
                bodySha256: 'hash',
            }))
        );

        const updatePromise = autoUpdatePlaylists(
            pendingFetches.map((_, index) =>
                createUrlPlaylist(
                    `playlist-${index}`,
                    `https://example.test/${index}.m3u`
                )
            )
        );

        await flushMicrotasks();
        expect(startedFetches).toBe(AUTO_UPDATE_CONCURRENCY);

        pendingFetches[0].resolve(createPlaylist());
        await flushMicrotasks();
        expect(startedFetches).toBe(AUTO_UPDATE_CONCURRENCY + 1);

        for (const pendingFetch of pendingFetches.slice(1)) {
            pendingFetch.resolve(createPlaylist());
        }

        const result = await updatePromise;
        expect(result.playlists).toHaveLength(pendingFetches.length);
        expect(result.outcomes).toHaveLength(pendingFetches.length);
    });

    it('preserves user-owned fields and refreshes file-based playlists', async () => {
        mockFetchPlaylistFromFile.mockResolvedValue(
            createPlaylist({
                _id: 'regenerated',
                autoRefresh: false,
                favorites: [],
                title: 'Refreshed from file',
                userAgent: undefined,
            })
        );

        const result = await autoUpdatePlaylists([
            createPlaylist({
                _id: 'file-playlist',
                autoRefresh: true,
                favorites: ['fav-channel'],
                filePath: '/playlists/local.m3u',
                importDate: '',
                title: 'File playlist',
                userAgent: 'PlaylistAgent/1.0',
            }),
        ]);

        expect(mockFetchPlaylistFromFile).toHaveBeenCalledWith(
            '/playlists/local.m3u',
            'File playlist'
        );
        expect(result.playlists).toEqual([
            expect.objectContaining({
                _id: 'file-playlist',
                autoRefresh: true,
                favorites: ['fav-channel'],
                title: 'Refreshed from file',
                userAgent: 'PlaylistAgent/1.0',
            }),
        ]);
        expect(result.outcomes).toEqual([
            {
                playlistId: 'file-playlist',
                status: 'updated',
                title: 'File playlist',
            },
        ]);
    });

    it('downloads startup refreshes with each playlist’s own User-Agent', async () => {
        mockFetchPlaylistFromUrlConditional.mockResolvedValue({
            status: 'updated',
            playlist: createPlaylist(),
            bodySha256: 'hash-ua',
        });
        const playlist = createPlaylist({
            url: 'https://example.test/list.m3u',
            userAgent: 'IPTVnator-Test/1.0',
        });
        await autoUpdatePlaylists([playlist]);
        expect(mockFetchPlaylistFromUrlConditional).toHaveBeenCalledWith(
            playlist.url,
            playlist.title,
            expect.objectContaining({ userAgent: playlist.userAgent })
        );
    });

    it('skips playlists without a usable source and forwards trust options', async () => {
        mockFetchPlaylistFromUrlConditional.mockResolvedValue({
            status: 'updated',
            playlist: createPlaylist(),
            bodySha256: 'hash-trust',
        });

        const result = await autoUpdatePlaylists(
            [
                createPlaylist({
                    _id: 'no-source',
                    filePath: undefined,
                    title: 'No source',
                    url: undefined,
                }),
                createUrlPlaylist(
                    'reachable',
                    'https://reachable.test/list.m3u'
                ),
            ],
            { trustedInsecureTlsHosts: ['self-signed.test'] }
        );

        expect(result.playlists).toHaveLength(1);
        expect(result.outcomes).toEqual([
            { playlistId: 'no-source', status: 'skipped', title: 'No source' },
            { playlistId: 'reachable', status: 'updated', title: 'reachable' },
        ]);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Skipping playlist "No source": no URL or file path found'
        );
        expect(mockFetchPlaylistFromUrlConditional).toHaveBeenCalledWith(
            'https://reachable.test/list.m3u',
            'reachable',
            expect.objectContaining({
                trustedInsecureTlsHosts: ['self-signed.test'],
            })
        );
    });

    it('redacts playlist credentials from the refresh log', async () => {
        mockFetchPlaylistFromUrlConditional.mockResolvedValue({
            status: 'updated',
            playlist: createPlaylist(),
            bodySha256: 'hash-redacted',
        });

        await autoUpdatePlaylists([
            createUrlPlaylist(
                'xtream',
                'https://portal.test/get.php?username=alice&password=hunter2'
            ),
        ]);

        const loggedMessages = consoleLogSpy.mock.calls.map(([message]) =>
            String(message)
        );
        expect(
            loggedMessages.some((message) => message.includes('hunter2'))
        ).toBe(false);
        expect(
            loggedMessages.some((message) => message.includes('alice'))
        ).toBe(false);
        expect(
            loggedMessages.some((message) =>
                message.includes('Updating playlist "xtream" from URL:')
            )
        ).toBe(true);
    });

    it('reports unchanged outcome without returning playlist for persistence', async () => {
        mockFetchPlaylistFromUrlConditional.mockResolvedValue({
            status: 'unchanged',
            bodySha256: 'same-hash',
            etag: '"e1"',
            fromNotModified: true,
        });

        const result = await autoUpdatePlaylists([
            createUrlPlaylist('same', 'https://example.test/same.m3u'),
        ]);

        expect(result.playlists).toEqual([]);
        expect(result.outcomes).toEqual([
            { playlistId: 'same', status: 'unchanged', title: 'same' },
        ]);
        expect(mockRecordConditionalRefreshSuccess).toHaveBeenCalled();
    });

    it('defers automatic check while failure backoff nextCheckAt is in the future', async () => {
        const future = new Date(Date.now() + 180_000).toISOString();
        mockPrepareConditionalRefresh.mockResolvedValue({
            enabled: true,
            forceFullDownload: false,
            state: {
                bodySha256: 'prev',
                itemsRevision: 1,
                checkedAt: new Date().toISOString(),
                nextCheckAt: future,
                failures: 1,
            },
        });

        const result = await autoUpdatePlaylists([
            createUrlPlaylist('backed-off', 'https://example.test/slow.m3u'),
        ]);

        expect(mockFetchPlaylistFromUrlConditional).not.toHaveBeenCalled();
        expect(result.playlists).toEqual([]);
        expect(result.outcomes).toEqual([
            {
                playlistId: 'backed-off',
                status: 'unchanged',
                title: 'backed-off',
            },
        ]);
    });
});
