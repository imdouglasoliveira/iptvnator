import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createSyntheticM3uCatalogFixture,
    SYNTHETIC_M3U_CATALOG_ENTRY_COUNT,
    SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES,
    SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES,
} from './synthetic-m3u-catalog';

const CATALOG_GOLDEN_SHA256 =
    '1257010e9ff4a469736f9681b65e73b9af3d6f9b4465278b9bbbffd89161a7c1';

describe('synthetic provider-shaped M3U catalog', () => {
    const fixture = createSyntheticM3uCatalogFixture();
    const lines = fixture.body.trimEnd().split('\n');
    const urls = lines.filter((line) => !line.startsWith('#'));

    it('generates the 380k catalog deterministically', () => {
        assert.equal(SYNTHETIC_M3U_CATALOG_ENTRY_COUNT, 380_000);
        assert.equal(fixture.channelCount, 380_000);
        assert.equal(fixture.bytes, 92_525_598);
        assert.equal(fixture.sha256, CATALOG_GOLDEN_SHA256);
        assert.equal(lines[0], '#EXTM3U');
        assert.equal(lines.length, 1 + 380_000 * 2);
    });

    it('mixes live channels, movies and series episodes like a provider export', () => {
        const count = (kind: string) =>
            urls.filter((url) => url.startsWith(`http://127.0.0.1/${kind}/`))
                .length;

        assert.equal(count('live'), SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES);
        assert.equal(count('movie'), SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES);
        assert.equal(
            count('series'),
            380_000 -
                SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES -
                SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES
        );
    });

    it('carries tvg attributes and only loopback URLs', () => {
        assert.match(
            lines[1],
            /^#EXTINF:-1 tvg-id="synthetic-000001" tvg-name="[^"]+" tvg-logo="http:\/\/127\.0\.0\.1\/logo\/\d+\/1\.png" group-title="[^"]+",/
        );
        for (const url of fixture.body.match(/https?:\/\/[^\s"]+/g) ?? []) {
            assert.ok(url.startsWith('http://127.0.0.1/'), url);
        }
    });

    it('groups numbered episodes into 18,000 multi-season series with repeated titles', () => {
        const series = new Map<
            string,
            { seasons: Set<string>; episodes: Set<string> }
        >();
        const titles = new Set<string>();
        const firstEpisode =
            SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES +
            SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES;
        for (let index = firstEpisode; index < fixture.channelCount; index += 1) {
            const name = /,(Synthetic Series \d{5}) (\d{4}) S(\d{2})E(\d{2})$/.exec(
                lines[index * 2 + 1]
            );
            assert.ok(name, `Missing episode numbering at position ${index}`);
            const [, title, year, season, episode] = name;
            const key = `${title} ${year}`;
            const show = series.get(key) ?? {
                seasons: new Set<string>(),
                episodes: new Set<string>(),
            };
            show.seasons.add(season);
            const episodeKey = `${season}:${episode}`;
            assert.ok(!show.episodes.has(episodeKey));
            show.episodes.add(episodeKey);
            series.set(key, show);
            titles.add(title);
        }
        assert.equal(series.size, 18_000);
        assert.equal(titles.size, 9_000);
        for (const show of series.values()) {
            assert.equal(show.seasons.size, 2);
            assert.ok(show.episodes.size === 18 || show.episodes.size === 19);
        }
    });
});
