import { createHash } from 'node:crypto';

import { SYNTHETIC_TITLE_VOCABULARY } from './synthetic-charset';
import { SYNTHETIC_M3U_SEED, type SyntheticM3uFixture } from './synthetic-m3u';

/**
 * Provider-shaped catalog: the entry count and mix of a large Xtream M3U
 * export (a few live channels, many movies, mostly series episodes), with
 * tvg attributes and loopback URLs only. Opt-in scenario; the formal
 * 10k/50k/100k fixtures stay attribute-free.
 */
export const SYNTHETIC_M3U_CATALOG_ENTRY_COUNT = 380_000;
export const SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES = 1_800;
export const SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES = 48_000;
const CATALOG_GROUP_COUNT = 300;

export function createSyntheticM3uCatalogFixture(): SyntheticM3uFixture {
    const titles = SYNTHETIC_TITLE_VOCABULARY.latin1;
    const lines = new Array<string>(1 + SYNTHETIC_M3U_CATALOG_ENTRY_COUNT * 2);
    lines[0] = '#EXTM3U';

    for (
        let offset = 0;
        offset < SYNTHETIC_M3U_CATALOG_ENTRY_COUNT;
        offset += 1
    ) {
        const index = offset + 1;
        const stableIndex = String(index).padStart(6, '0');
        const group = String((offset % CATALOG_GROUP_COUNT) + 1).padStart(
            3,
            '0'
        );
        const name = `${titles.channel} ${SYNTHETIC_M3U_SEED}-${stableIndex}`;
        const kind =
            offset < SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES
                ? 'live'
                : offset <
                    SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES +
                        SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES
                  ? 'movie'
                  : 'series';
        const extension = kind === 'live' ? 'ts' : 'mp4';
        const lineOffset = 1 + offset * 2;

        lines[lineOffset] =
            `#EXTINF:-1 tvg-id="synthetic-${stableIndex}" tvg-name="${name}" ` +
            `tvg-logo="http://127.0.0.1/logo/${SYNTHETIC_M3U_SEED}/${index}.png" ` +
            `group-title="${titles.group} ${group}",${name}`;
        lines[lineOffset + 1] =
            `http://127.0.0.1/${kind}/${SYNTHETIC_M3U_SEED}/${index}.${extension}`;
    }

    const body = `${lines.join('\n')}\n`;
    return Object.freeze({
        body,
        bytes: Buffer.byteLength(body, 'utf8'),
        channelCount: SYNTHETIC_M3U_CATALOG_ENTRY_COUNT,
        charset: 'latin1',
        sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    });
}
