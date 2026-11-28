import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    DatabaseService,
    ParentalLockService,
    PlaylistsService,
} from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import { m3uMovieStableId } from '@iptvnator/shared/m3u-utils/catalog';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import * as xtreamMapper from './unified-favorites-xtream.mapper';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';

const base = 'http://media.example.test';
const heldMovie = `${base}/movie/u/p/202.mp4`;
const openMovie = `${base}/movie/u/p/201.mp4`;
const entry = (name: string, url: string, group: string) =>
    ({
        id: name,
        name,
        url,
        group: { title: group },
        tvg: { id: '', name: '', url: '', logo: '', rec: '' },
    }) as unknown as Channel;

const seriesRow = {
    id: null,
    category_id: null,
    favorite_id: 7,
    playlist_id: 'm3u-1',
    playlist_name: 'Synthetic list',
    playlist_type: 'm3u-text',
    xtream_id: 31,
    title: 'Show 31',
    type: 'series',
    poster_url: 'http://img.example.test/31.jpg',
    added_at: '2026-03-01T10:00:00.000Z',
    position: 1,
};
const xtreamRow = {
    id: 10,
    category_id: 1,
    favorite_id: 3,
    playlist_id: 'xtream-1',
    playlist_name: 'Synthetic portal',
    playlist_type: 'xtream',
    xtream_id: 101,
    title: 'Portal movie',
    type: 'movie',
    added_at: '2026-03-02T10:00:00.000Z',
    position: 0,
};
const bridgeMethods = [
    'dbGetPlaylist',
    'dbRestoreXtreamFavorites',
    'dbGetRecentlyViewed',
    'dbClearRecentlyViewed',
    'dbGetAllGlobalFavorites',
    'dbGetGlobalRecentlyAdded',
    'dbAddFavorite',
    'dbRemoveFavorite',
    'dbGetFavorites',
    'dbGetRecentItems',
    'dbAddRecentItem',
    'dbClearPlaylistRecentItems',
    'dbRemoveRecentItem',
    'dbRemoveRecentItemsBatch',
    'dbGetContentByXtreamId',
];

describe('UnifiedFavoritesDataService with M3U catalog rows', () => {
    let service: UnifiedFavoritesDataService;
    let electron: Record<string, jest.Mock>;
    let database: Record<string, jest.Mock>;
    let store: { dispatch: jest.Mock; select: jest.Mock };
    let lock: Record<string, jest.Mock>;
    let channels: Channel[];
    let playlistFavorites: string[];

    beforeEach(() => {
        playlistFavorites = ['m3u-series:31'];
        channels = [
            entry('Film Open', openMovie, 'Kids'),
            entry('Film Held', heldMovie, 'Adult'),
        ];
        electron = {};
        for (const name of bridgeMethods) electron[name] = jest.fn();
        electron['dbReorderGlobalFavorites'] = jest
            .fn()
            .mockResolvedValue({ success: true });
        Object.defineProperty(window, 'electron', {
            value: electron,
            configurable: true,
        });
        database = {
            getAllGlobalFavorites: jest
                .fn()
                .mockResolvedValue([seriesRow, xtreamRow]),
            getFavorites: jest.fn().mockResolvedValue([]),
            setM3uCatalogFavorite: jest
                .fn()
                .mockResolvedValue({ favoriteId: null }),
        };
        store = {
            dispatch: jest.fn(),
            select: jest.fn(() =>
                of([
                    {
                        _id: 'm3u-1',
                        title: 'Synthetic list',
                        favorites: playlistFavorites,
                    },
                    { _id: 'xtream-1', serverUrl: 'http://panel.example.test' },
                ])
            ),
        };
        lock = {
            active: jest.fn().mockReturnValue(false),
            withholdsEverything: jest.fn().mockReturnValue(false),
            lockedGroupTitles: jest.fn().mockReturnValue(['Adult']),
        };
        TestBed.configureTestingModule({
            providers: [
                UnifiedFavoritesDataService,
                { provide: Store, useValue: store },
                { provide: DatabaseService, useValue: database },
                { provide: ParentalLockService, useValue: lock },
                { provide: XTREAM_DATA_SOURCE, useValue: {} },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: jest.fn(() =>
                            of({
                                _id: 'm3u-1',
                                favorites: playlistFavorites,
                                playlist: { items: channels },
                            })
                        ),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        service = TestBed.inject(UnifiedFavoritesDataService);
    });

    afterEach(() => jest.restoreAllMocks());

    it('maps a table row of an M3U playlist to an m3u series item without calling the Xtream mapper', async () => {
        const mapXtreamRow = jest.spyOn(xtreamMapper, 'mapXtreamRow');

        const items = await service.getFavorites('all');

        const series = items.find((item) => item.contentType === 'series');
        expect(series).toEqual(
            expect.objectContaining({
                sourceType: 'm3u',
                name: 'Show 31',
                posterUrl: 'http://img.example.test/31.jpg',
                m3uCatalogId: 31,
                favoriteId: 7,
            })
        );
        expect(mapXtreamRow).toHaveBeenCalledTimes(1);
        expect(mapXtreamRow).toHaveBeenCalledWith(xtreamRow);
        expect(items.map((item) => item.sourceType).sort()).toEqual([
            'm3u',
            'xtream',
        ]);
    });

    it('keeps a row without a playlist type mapped as Xtream (control)', async () => {
        database['getAllGlobalFavorites'].mockResolvedValue([
            { ...xtreamRow, playlist_type: undefined },
        ]);

        const [item] = await service.getFavorites('all');

        expect(item).toEqual(
            expect.objectContaining({ sourceType: 'xtream', xtreamId: 101 })
        );
    });

    it('removes the row and the playlist entry for a favorite removed from the page', async () => {
        const [series] = (await service.getFavorites('all')).filter(
            (item) => item.contentType === 'series'
        );

        await service.removeFavorite(series);

        expect(database['setM3uCatalogFavorite']).toHaveBeenCalledWith(
            expect.objectContaining({
                playlistId: 'm3u-1',
                type: 'series',
                stableId: 31,
                favorite: false,
            })
        );
        const update = store.dispatch.mock.calls[0][0] as {
            playlist: { favorites: string[] };
        };
        expect(update.playlist.favorites).toEqual([]);
    });

    it('clears catalog favorites by favorite id and leaves the Xtream removal alone', async () => {
        const items = await service.getFavorites('all');

        await service.clearFavorites(
            items.filter((item) => item.m3uCatalogId != null)
        );

        expect(database['setM3uCatalogFavorite']).toHaveBeenCalledTimes(1);
        expect(electron['dbRemoveFavorite']).not.toHaveBeenCalled();
    });

    it('saves the position of an M3U row next to the Xtream rows', async () => {
        const items = await service.getFavorites('all');
        const ordered = [
            items.find((item) => item.sourceType === 'xtream')!,
            items.find((item) => item.sourceType === 'm3u')!,
        ];

        await service.reorder(ordered, { scope: 'all' });

        expect(electron['dbReorderGlobalFavorites']).toHaveBeenCalledWith([
            { favorite_id: 3, playlist_id: 'xtream-1', position: 0 },
            { favorite_id: 7, playlist_id: 'm3u-1', position: 1 },
        ]);
    });

    it('lists a movie saved in the table once, with the URL kept in the playlist JSON', async () => {
        database['getAllGlobalFavorites'].mockResolvedValue([
            {
                ...seriesRow,
                favorite_id: 8,
                type: 'movie',
                xtream_id: m3uMovieStableId(openMovie),
                title: 'Film Open',
            },
        ]);
        playlistFavorites = [openMovie];

        const items = await service.getFavorites('all');

        expect(items).toHaveLength(1);
        expect(items[0]).toEqual(
            expect.objectContaining({
                contentType: 'movie',
                streamUrl: openMovie,
                favoriteId: 8,
            })
        );
    });

    it('hides the item of a withheld group and shows the item of a free group under the lock', async () => {
        lock['active'].mockReturnValue(true);
        database['getAllGlobalFavorites'].mockResolvedValue([
            {
                ...seriesRow,
                type: 'movie',
                favorite_id: 8,
                xtream_id: m3uMovieStableId(heldMovie),
                title: 'Film Held',
            },
            {
                ...seriesRow,
                type: 'movie',
                favorite_id: 9,
                xtream_id: m3uMovieStableId(openMovie),
                title: 'Film Open',
            },
        ]);
        playlistFavorites = [];

        const items = await service.getFavorites('all');

        expect(items.map((item) => item.name)).toEqual(['Film Open']);
    });
});
