import { Channel } from '@iptvnator/shared/interfaces';
import { buildM3uCatalogIndex } from '@iptvnator/shared/m3u-utils/catalog';
import { buildM3uSeriesCatalog } from '@iptvnator/shared/m3u-utils/series';
import { findM3uSeriesOfEpisode } from './m3u-series-of-episode.util';

const row = (id: string, url: string, name: string) =>
    ({ id, url, name, group: { title: 'Shows' }, tvg: {} }) as unknown as Channel;

const HOLLOW = row('r1', 'http://h.example/series/u/p/1.mp4', 'Hollow S01E01');
const EMBER = row('r2', 'http://h.example/series/u/p/2.mp4', 'Ember S01E01');

const series = buildM3uSeriesCatalog(
    buildM3uCatalogIndex([HOLLOW, EMBER]).byKind.episode,
    'pl-1'
);

describe('findM3uSeriesOfEpisode', () => {
    it('finds the show an episode row belongs to', () => {
        expect(findM3uSeriesOfEpisode(series, EMBER.url, 'r2')?.title).toBe(
            'Ember'
        );
    });

    it('falls back to the URL when the row id is stale', () => {
        expect(findM3uSeriesOfEpisode(series, HOLLOW.url, 'gone')?.title).toBe(
            'Hollow'
        );
    });

    it('finds nothing for a URL that is not an episode', () => {
        expect(
            findM3uSeriesOfEpisode(series, 'http://h.example/live/1.ts', '')
        ).toBeUndefined();
    });
});
