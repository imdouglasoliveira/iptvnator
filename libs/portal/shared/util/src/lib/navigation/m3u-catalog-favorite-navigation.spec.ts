import type { PortalFavoriteItem } from '@iptvnator/shared/interfaces';
import { UnifiedCollectionItem } from '../collection/unified-collection-item.interface';
import {
    m3uCatalogDashboardTarget,
    m3uCatalogFavoriteTarget,
} from './m3u-catalog-favorite-navigation';
import { getUnifiedCollectionNavigation } from './workspace-portal-navigation';

const catalogItem = (
    overrides: Partial<UnifiedCollectionItem> = {}
): UnifiedCollectionItem => ({
    uid: 'm3u::pl-1::catalog:series:31',
    name: 'Show 31',
    contentType: 'series',
    sourceType: 'm3u',
    playlistId: 'pl-1',
    playlistName: 'List',
    m3uCatalogId: 31,
    favoriteId: 7,
    ...overrides,
});

const railItem = (overrides: Partial<PortalFavoriteItem> = {}) =>
    ({
        id: 'favorite:7',
        title: 'Show 31',
        type: 'series',
        playlist_id: 'pl-1',
        category_id: '',
        xtream_id: 31,
        added_at: '2026-03-01T10:00:00.000Z',
        source: 'm3u',
        ...overrides,
    }) as PortalFavoriteItem;

describe('M3U catalog favorite navigation', () => {
    it('opens a favorite series on its own page from the collection', () => {
        expect(getUnifiedCollectionNavigation(catalogItem())).toEqual({
            link: ['/workspace', 'playlists', 'pl-1', 'series', '31'],
        });
    });

    it('opens a favorite movie through the saved URL when the JSON still has it', () => {
        expect(
            getUnifiedCollectionNavigation(
                catalogItem({
                    contentType: 'movie',
                    m3uCatalogId: 101,
                    streamUrl: 'http://h.example/movie/u/p/101.mp4',
                })
            )?.state
        ).toEqual({ openM3uChannelUrl: 'http://h.example/movie/u/p/101.mp4' });
    });

    it('has no page for a movie saved only in the table, and none for a series without an id', () => {
        expect(
            m3uCatalogFavoriteTarget(
                catalogItem({ contentType: 'movie', m3uCatalogId: 101 })
            )
        ).toBeNull();
        expect(
            m3uCatalogFavoriteTarget(catalogItem({ m3uCatalogId: undefined }))
        ).toBeNull();
    });

    it('routes the dashboard rail row of a series to the series page and a movie to the Movies section', () => {
        expect(m3uCatalogDashboardTarget(railItem())).toEqual({
            link: ['/workspace', 'playlists', 'pl-1', 'series', '31'],
        });
        expect(m3uCatalogDashboardTarget(railItem({ type: 'movie' }))).toEqual({
            link: ['/workspace', 'playlists', 'pl-1', 'vod'],
        });
    });

    it('leaves live M3U rows and portal rows to the existing routes', () => {
        expect(
            m3uCatalogDashboardTarget(railItem({ type: 'live' }))
        ).toBeNull();
        expect(
            m3uCatalogDashboardTarget(railItem({ source: 'xtream' }))
        ).toBeNull();
    });
});
