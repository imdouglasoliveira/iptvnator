import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createSyntheticM3uCatalogFixture,
    SYNTHETIC_M3U_CATALOG_ENTRY_COUNT,
    SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES,
    SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES,
} from './synthetic-m3u-catalog';

const CATALOG_GOLDEN_SHA256 =
    '2d2028bb6f11354f2ee91f4c5006abb607a440d4c9a58f22cfa334a8dbe551bf';

describe('synthetic provider-shaped M3U catalog', () => {
    const fixture = createSyntheticM3uCatalogFixture();
    const lines = fixture.body.trimEnd().split('\n');
    const urls = lines.filter((line) => !line.startsWith('#'));

    it('generates the 380k catalog deterministically', () => {
        assert.equal(SYNTHETIC_M3U_CATALOG_ENTRY_COUNT, 380_000);
        assert.equal(fixture.channelCount, 380_000);
        assert.equal(fixture.bytes, 90_544_398);
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
});
