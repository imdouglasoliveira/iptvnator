import { firstValueFrom, of } from 'rxjs';
import type {
    M3uActivityMutationRequest,
    M3uActivityMutationResult,
    M3uRecentlyViewedItem,
    Playlist,
} from '@iptvnator/shared/interfaces';
import { PlaylistsService } from './playlists.service';

// PLAN-006 C-1: tapping a channel of a huge M3U source must not move the
// whole playlist document over the bridge.
describe('PlaylistsService M3U activity partial write', () => {
    const original = window.electron;
    const item = (url: string): M3uRecentlyViewedItem => ({
        source: 'm3u',
        id: url,
        url,
        title: url,
        category_id: 'live',
        added_at: '2026-01-01T00:00:00.000Z',
    });

    afterEach(() => {
        window.electron = original;
    });

    function setup(options: {
        activity?: (
            request: M3uActivityMutationRequest
        ) => Promise<M3uActivityMutationResult>;
        historyActive?: boolean;
    }) {
        const document = {
            _id: 'm3u',
            title: 'M3U',
            recentlyViewed: [],
        } as unknown as Playlist;
        const electron = {
            dbGetAppState: jest.fn(async () => '1'),
            dbSetAppState: jest.fn(),
            dbGetAppPlaylist: jest.fn(async () => document),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbUpsertAppPlaylist: jest.fn(async () => undefined),
            dbUpsertAppPlaylistKeepingActivity: jest.fn(async () => undefined),
            ...(options.activity
                ? { dbMutateM3uActivity: jest.fn(options.activity) }
                : {}),
        };
        window.electron = electron as unknown as typeof window.electron;
        const service = Object.create(
            PlaylistsService.prototype
        ) as PlaylistsService;
        Object.assign(service, {
            historySync: {
                active: () => options.historyActive ?? false,
                project: async <T>(row: T) => row,
                mutate: async () => null,
            },
            favoriteSync: {
                active: () => false,
                project: async <T>(row: T) => row,
                mutate: async () => null,
            },
            dbService: { getAll: jest.fn(() => of([])) },
            storageBackend: {
                kind: () => 'electron',
                documentStore: () => window.electron,
            },
            electronMigrationPromise: null,
            playlistWriteQueues: new Map(),
            deletingAll: Promise.resolve(),
            resets: 0,
        });
        const wholeDocumentCalls = () =>
            electron.dbGetAppPlaylist.mock.calls.length +
            electron.dbGetAppPlaylists.mock.calls.length +
            electron.dbUpsertAppPlaylist.mock.calls.length;
        return { electron, service, wholeDocumentCalls };
    }

    it('touches, removes and clears history with zero whole-document calls', async () => {
        const { electron, service, wholeDocumentCalls } = setup({
            activity: async (request) => ({
                status: 'applied',
                recentlyViewed:
                    request.command.kind === 'history.touch'
                        ? [request.command.item]
                        : [],
            }),
        });

        const touched = await firstValueFrom(
            service.addM3uRecentlyViewed('m3u', item('http://a.example.test/1'))
        );
        await firstValueFrom(
            service.removeFromPlaylistRecentlyViewedBatch('m3u', [
                'http://a.example.test/1',
            ])
        );
        await firstValueFrom(service.clearPlaylistRecentlyViewed('m3u'));

        expect(touched.recentlyViewed).toEqual([
            item('http://a.example.test/1'),
        ]);
        expect(electron.dbMutateM3uActivity).toHaveBeenCalledTimes(3);
        expect(wholeDocumentCalls()).toBe(0);
    });

    it.each([
        [
            'the worker declines (kill switch or non-M3U source)',
            {
                activity: async () =>
                    ({ status: 'unavailable', reason: 'disabled' }) as const,
            },
        ],
        ['the bridge lacks the command', {}],
        [
            'a synced history profile is active',
            {
                activity: async () =>
                    ({ status: 'applied', recentlyViewed: [] }) as const,
                historyActive: true,
            },
        ],
    ])('falls back to the document path when %s', async (_name, options) => {
        const { service, electron, wholeDocumentCalls } = setup(options);

        await firstValueFrom(
            service.addM3uRecentlyViewed('m3u', item('http://a.example.test/2'))
        );

        expect(wholeDocumentCalls()).toBeGreaterThan(0);
        expect(electron.dbUpsertAppPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                recentlyViewed: [
                    expect.objectContaining({ url: 'http://a.example.test/2' }),
                ],
            })
        );
    });

    it('writes a refresh through the upsert that keeps the stored history', async () => {
        const { service, electron } = setup({});

        await firstValueFrom(
            service.updatePlaylist('m3u', {
                _id: 'm3u',
                title: 'M3U',
            } as Playlist)
        );

        expect(
            electron.dbUpsertAppPlaylistKeepingActivity
        ).toHaveBeenCalledTimes(1);
        expect(electron.dbUpsertAppPlaylist).not.toHaveBeenCalled();
    });
});
