import { m3uMovieStableId } from '@iptvnator/shared/m3u-utils/catalog';
import { M3uCatalogCard } from './m3u-catalog-card.util';
import {
    M3U_FAVORITES_GROUP_ID,
    initialCatalogGroup,
    m3uCardFavoriteId,
    m3uFavoriteCards,
    withFavoritesGroup,
} from './m3u-catalog-favorites-group.util';

const MOVIE_URL = 'http://h.example/movie/u/p/7.mkv';
const movieCard: M3uCatalogCard = {
    id: 'm1',
    name: 'Sandline',
    title: 'Sandline',
    channelUrl: MOVIE_URL,
};
const otherMovie: M3uCatalogCard = {
    id: 'm2',
    name: 'Gridlock',
    title: 'Gridlock',
    channelUrl: 'http://h.example/movie/u/p/8.mkv',
};
const seriesCard: M3uCatalogCard = {
    id: 'series:42',
    name: 'Hollow',
    title: 'Hollow',
    seriesId: 42,
};

describe('m3u catalog favorites group', () => {
    it('puts Favoritos first, in the format of a provider group', () => {
        const items = withFavoritesGroup(
            [{ id: 'Films', name: 'Films', count: 3 }],
            'Favoritos',
            2
        );

        expect(items.map((item) => item.id)).toEqual([
            M3U_FAVORITES_GROUP_ID,
            'Films',
        ]);
        expect(items[0]).toEqual({
            id: M3U_FAVORITES_GROUP_ID,
            name: 'Favoritos',
            count: 2,
        });
    });

    it('keys a movie by its stable id and a series by its series id', () => {
        expect(m3uCardFavoriteId(movieCard)).toBe(m3uMovieStableId(MOVIE_URL));
        expect(m3uCardFavoriteId(seriesCard)).toBe(42);
    });

    it('keeps only the cards whose id is favorited', () => {
        const ids = new Set([m3uMovieStableId(MOVIE_URL), 42]);

        expect(m3uFavoriteCards([movieCard, otherMovie], ids)).toEqual([
            movieCard,
        ]);
        expect(m3uFavoriteCards([seriesCard], ids)).toEqual([seriesCard]);
        expect(m3uFavoriteCards([movieCard], new Set())).toEqual([]);
    });

    it('selects Favoritos on arrival only when it has items', () => {
        expect(initialCatalogGroup(['Films', 'Classics'], true, 2)).toBe(
            M3U_FAVORITES_GROUP_ID
        );
        expect(initialCatalogGroup(['Films', 'Classics'], true, 0)).toBe(
            'Films'
        );
        expect(initialCatalogGroup(['Films'], false, 5)).toBe('Films');
        expect(initialCatalogGroup([], true, 0)).toBeNull();
    });
});
