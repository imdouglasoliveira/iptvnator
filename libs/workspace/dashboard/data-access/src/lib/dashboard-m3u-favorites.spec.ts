import type { GlobalFavoriteItem } from '@iptvnator/services';
import { mapDbFavoriteToItem } from './dashboard-mappers';
import {
    getGlobalFavoriteLink,
    getGlobalFavoriteNavigationState,
} from './dashboard-navigation.util';

const row = (overrides: Partial<GlobalFavoriteItem> = {}) =>
    ({
        id: null,
        favorite_id: 7,
        playlist_id: 'pl-1',
        playlist_name: 'List',
        playlist_type: 'm3u-text',
        xtream_id: 31,
        title: 'Show 31',
        type: 'series',
        poster_url: 'http://img.example.test/31.jpg',
        added_at: '2026-03-01T10:00:00.000Z',
        ...overrides,
    }) as unknown as GlobalFavoriteItem;

describe('dashboard favorites of an M3U playlist', () => {
    it.each(['m3u-file', 'm3u-text', 'm3u-url'] as const)(
        'maps a %s table row as an m3u item',
        (playlist_type) => {
            expect(mapDbFavoriteToItem(row({ playlist_type })).source).toBe(
                'm3u'
            );
        }
    );

    it('keeps portal rows, and rows without a playlist type, as xtream', () => {
        expect(
            mapDbFavoriteToItem(row({ playlist_type: 'xtream' })).source
        ).toBe('xtream');
        expect(
            mapDbFavoriteToItem(row({ playlist_type: undefined })).source
        ).toBe('xtream');
    });

    it('routes a favorite M3U series to its series page', () => {
        const item = mapDbFavoriteToItem(row());

        expect(getGlobalFavoriteLink(item)).toEqual([
            '/workspace',
            'playlists',
            'pl-1',
            'series',
            '31',
        ]);
        expect(getGlobalFavoriteNavigationState(item)).toBeUndefined();
    });

    it('still routes a portal series through the portal', () => {
        const item = mapDbFavoriteToItem(
            row({ playlist_type: 'xtream', category_id: 4 } as never)
        );

        expect(getGlobalFavoriteLink(item)[1]).not.toBe('playlists');
    });
});
