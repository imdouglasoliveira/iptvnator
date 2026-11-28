import type {
    UnifiedCollectionItem,
    XtreamFavoriteRow,
} from '@iptvnator/portal/shared/util';
import { m3uMovieStableId } from '@iptvnator/shared/m3u-utils/catalog';
import {
    buildFavoritePositionUpdates,
    isM3uPlaylistType,
    mapM3uCatalogRow,
    mergeM3uCatalogFavorites,
    splitFavoriteRowsByPlaylist,
} from './m3u-catalog-favorites.mapper';

const movieUrl = 'http://media.example.test/movie/u/p/101.mp4?token=a';

function row(overrides: Partial<XtreamFavoriteRow> = {}): XtreamFavoriteRow {
    return {
        id: null,
        category_id: null,
        favorite_id: 7,
        playlist_id: 'list-1',
        playlist_name: 'Synthetic list',
        playlist_type: 'm3u-text',
        xtream_id: 31,
        title: 'Show 31',
        type: 'series',
        poster_url: 'http://img.example.test/31.jpg',
        added_at: '2026-03-01T10:00:00.000Z',
        position: 2,
        ...overrides,
    };
}

function jsonMovie(overrides: Partial<UnifiedCollectionItem> = {}) {
    return {
        uid: `m3u::list-1::${movieUrl}`,
        name: 'Film One',
        contentType: 'movie',
        sourceType: 'm3u',
        playlistId: 'list-1',
        playlistName: 'Synthetic list',
        streamUrl: movieUrl,
        posterUrl: 'http://img.example.test/101.jpg',
        addedAt: new Date(0).toISOString(),
        position: 0,
        ...overrides,
    } as UnifiedCollectionItem;
}

describe('m3u catalog favorites mapper', () => {
    it('recognizes the three M3U playlist types and nothing else', () => {
        expect(
            ['m3u-file', 'm3u-text', 'm3u-url'].every(isM3uPlaylistType)
        ).toBe(true);
        expect(isM3uPlaylistType('xtream')).toBe(false);
        expect(isM3uPlaylistType('stalker')).toBe(false);
        expect(isM3uPlaylistType(undefined)).toBe(false);
    });

    it('splits rows by playlist type and sends only series and movies of M3U to the catalog side and drops a stray M3U live row', () => {
        const xtream = row({ playlist_type: 'xtream', playlist_id: 'x' });
        const untyped = row({ playlist_type: undefined, playlist_id: 'y' });
        const catalog = row();
        const live = row({
            type: 'live',
            xtream_id: 9,
            playlist_type: 'xtream',
        });
        const strayLive = row({ type: 'live', xtream_id: 10 });

        const split = splitFavoriteRowsByPlaylist([
            xtream,
            catalog,
            untyped,
            live,
            strayLive,
        ]);

        expect(split.xtream).toEqual([xtream, untyped, live]);
        expect(split.m3u).toEqual([catalog]);
    });

    it('maps a series row to an m3u item with the saved title, poster, order and favorite id', () => {
        const item = mapM3uCatalogRow(row());

        expect(item).toEqual(
            expect.objectContaining({
                uid: 'm3u::list-1::catalog:series:31',
                name: 'Show 31',
                contentType: 'series',
                sourceType: 'm3u',
                playlistId: 'list-1',
                playlistName: 'Synthetic list',
                posterUrl: 'http://img.example.test/31.jpg',
                m3uCatalogId: 31,
                favoriteId: 7,
                position: 2,
                addedAt: '2026-03-01T10:00:00.000Z',
            })
        );
        expect(item.streamUrl).toBeUndefined();
        expect(item.xtreamId).toBeUndefined();
    });

    it('keeps the movie from the playlist JSON and attaches the row identity instead of listing it twice', () => {
        const movie = row({
            type: 'movie',
            xtream_id: m3uMovieStableId(movieUrl),
            favorite_id: 8,
            position: 4,
        });

        const merged = mergeM3uCatalogFavorites([jsonMovie()], [movie]);

        expect(merged).toHaveLength(1);
        expect(merged[0]).toEqual(
            expect.objectContaining({
                streamUrl: movieUrl,
                favoriteId: 8,
                m3uCatalogId: movie.xtream_id,
                position: 4,
            })
        );
    });

    it('lists a movie saved only in the table, and a second JSON entry of the same stream once', () => {
        const hd = jsonMovie({
            uid: 'm3u::list-1::hd',
            streamUrl: 'http://media.example.test/movie/u/p/101.mkv',
        });
        const stableId = m3uMovieStableId(movieUrl);
        const rows = [
            row({ type: 'movie', xtream_id: stableId, favorite_id: 8 }),
            row({
                type: 'movie',
                xtream_id: 555,
                favorite_id: 9,
                title: 'Film Only In Table',
            }),
        ];

        const merged = mergeM3uCatalogFavorites([jsonMovie(), hd], rows);

        expect(merged.map((item) => item.name)).toEqual([
            'Film One',
            'Film Only In Table',
        ]);
        expect(merged[1].uid).toBe('m3u::list-1::catalog:movie:555');
    });

    it('returns the JSON items untouched when there are no catalog rows', () => {
        const items = [jsonMovie()];

        expect(
            mergeM3uCatalogFavorites(items, [row({ playlist_type: 'xtream' })])
        ).toBe(items);
    });

    it('persists positions for M3U rows with a favorite id next to Xtream rows, and skips JSON-only items', () => {
        const catalog = mapM3uCatalogRow(row());
        const xtream = {
            uid: 'xtream::x::movie:5',
            name: 'Xtream movie',
            contentType: 'movie',
            sourceType: 'xtream',
            playlistId: 'x',
            playlistName: 'X',
            contentId: 50,
        } as UnifiedCollectionItem;

        expect(
            buildFavoritePositionUpdates([xtream, jsonMovie(), catalog])
        ).toEqual([
            { content_id: 50, playlist_id: 'x', position: 0 },
            { favorite_id: 7, playlist_id: 'list-1', position: 1 },
        ]);
    });
});
