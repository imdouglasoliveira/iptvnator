import { buildM3uCollectionLink } from './m3u-collection-section-link';

describe('buildM3uCollectionLink', () => {
    it('keeps a film inside the Movies section', () => {
        expect(buildM3uCollectionLink('pl-1', 'movie')).toEqual([
            '/workspace',
            'playlists',
            'pl-1',
            'vod',
            'play',
        ]);
    });

    it('keeps a series inside the Series section', () => {
        expect(buildM3uCollectionLink('pl-1', 'series')).toEqual([
            '/workspace',
            'playlists',
            'pl-1',
            'series',
        ]);
    });

    it('sends a live row to the full list', () => {
        expect(buildM3uCollectionLink('pl-1', 'live')).toEqual([
            '/workspace',
            'playlists',
            'pl-1',
            'all',
        ]);
    });
});
