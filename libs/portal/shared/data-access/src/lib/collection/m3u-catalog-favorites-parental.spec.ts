import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import { m3uMovieStableId } from '@iptvnator/shared/m3u-utils/catalog';
import { buildM3uSeriesCatalog } from '@iptvnator/shared/m3u-utils/series';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { M3uCatalogFavoritesParental } from './m3u-catalog-favorites-parental';
import { mapM3uCatalogRow } from './m3u-catalog-favorites.mapper';

const base = 'http://media.example.test';
const entry = (name: string, url: string, group: string) =>
    ({
        id: name,
        name,
        url,
        group: { title: group },
        tvg: { id: '', name: '', url: '', logo: '', rec: '' },
    }) as unknown as Channel;
const kidsMovie = `${base}/movie/u/p/201.mp4`;
const adultMovie = `${base}/movie/u/p/202.mp4`;
const channels = [
    entry('Film Kids', kidsMovie, 'Kids'),
    entry('Film Adult', adultMovie, 'Adult'),
    entry('GLASS ECHO S1 E1', `${base}/series/u/p/1.mp4`, 'Kids'),
    entry('GLASS ECHO S1 E2', `${base}/series/u/p/2.mp4`, 'Kids'),
    entry('DARK HOUSE S1 E1', `${base}/series/u/p/3.mp4`, 'Adult'),
    entry('DARK HOUSE S1 E2', `${base}/series/u/p/4.mp4`, 'Adult'),
];
const seriesId = (title: string) =>
    buildM3uSeriesCatalog(
        channels.filter((channel) => /S1 E\d/.test(channel.name)),
        'list-1'
    ).find((series) => series.title === title)?.id as number;

const item = (
    contentType: 'movie' | 'series',
    id: number,
    name: string
): UnifiedCollectionItem =>
    mapM3uCatalogRow({
        id: null,
        category_id: null,
        favorite_id: id,
        playlist_id: 'list-1',
        playlist_name: 'Synthetic list',
        playlist_type: 'm3u-text',
        xtream_id: id,
        title: name,
        type: contentType,
    });

describe('M3uCatalogFavoritesParental', () => {
    let lock: {
        active: jest.Mock;
        withholdsEverything: jest.Mock;
        lockedGroupTitles: jest.Mock;
    };
    let getPlaylistById: jest.Mock;
    let filter: (
        items: UnifiedCollectionItem[]
    ) => Promise<UnifiedCollectionItem[]>;

    const rows = () => [
        item('series', seriesId('GLASS ECHO'), 'Glass Echo'),
        item('series', seriesId('DARK HOUSE'), 'Dark House'),
        item('movie', m3uMovieStableId(kidsMovie), 'Film Kids'),
        item('movie', m3uMovieStableId(adultMovie), 'Film Adult'),
    ];
    const names = (items: UnifiedCollectionItem[]) =>
        items.map((entry) => entry.name);

    beforeEach(() => {
        lock = {
            active: jest.fn().mockReturnValue(true),
            withholdsEverything: jest.fn().mockReturnValue(false),
            lockedGroupTitles: jest.fn().mockReturnValue(['Adult']),
        };
        getPlaylistById = jest
            .fn()
            .mockReturnValue(of({ playlist: { items: channels } }));
        TestBed.configureTestingModule({
            providers: [
                { provide: ParentalLockService, useValue: lock },
                { provide: PlaylistsService, useValue: { getPlaylistById } },
            ],
        });
        const service = TestBed.inject(M3uCatalogFavoritesParental);
        filter = (items) => service.filter(items);
    });

    it('hides the series and the movie of a withheld group and keeps the free ones', async () => {
        expect(names(await filter(rows()))).toEqual([
            'Glass Echo',
            'Film Kids',
        ]);
    });

    it('shows every favorite when the lock is not active (control)', async () => {
        lock.active.mockReturnValue(false);

        expect(names(await filter(rows()))).toHaveLength(4);
        expect(getPlaylistById).not.toHaveBeenCalled();
    });

    it('shows every favorite when no group of the playlist is locked', async () => {
        lock.lockedGroupTitles.mockReturnValue([]);

        expect(names(await filter(rows()))).toHaveLength(4);
        expect(getPlaylistById).not.toHaveBeenCalled();
    });

    it('hides every catalog favorite when the lock cannot tell which groups are locked', async () => {
        lock.withholdsEverything.mockReturnValue(true);

        expect(await filter(rows())).toEqual([]);
        expect(getPlaylistById).not.toHaveBeenCalled();
    });

    it('hides the playlist favorites when its entries cannot be read, instead of showing them', async () => {
        getPlaylistById.mockReturnValue(of(undefined));

        expect(await filter(rows())).toEqual([]);
    });

    it('leaves items that are not catalog rows alone and never asks the lock about them', async () => {
        const live = {
            uid: 'm3u::list-1::http://media.example.test/live/1.ts',
            name: 'Channel One',
            contentType: 'live',
            sourceType: 'm3u',
            playlistId: 'list-1',
            playlistName: 'Synthetic list',
        } as UnifiedCollectionItem;

        expect(await filter([live])).toEqual([live]);
        expect(lock.active).not.toHaveBeenCalled();
    });
});
