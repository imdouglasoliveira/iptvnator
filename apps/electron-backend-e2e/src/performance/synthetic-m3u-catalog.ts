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
const SERIES_COUNT = 18_000;
const SERIES_TITLE_COUNT = SERIES_COUNT / 2;
const SERIES_EPISODE_COUNT =
    SYNTHETIC_M3U_CATALOG_ENTRY_COUNT -
    SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES -
    SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES;
const EPISODES_PER_SERIES = Math.floor(SERIES_EPISODE_COUNT / SERIES_COUNT);
const SERIES_WITH_EXTRA_EPISODE = SERIES_EPISODE_COUNT % SERIES_COUNT;
const FIRST_SEASON_EPISODES = 10;

export function syntheticM3uCatalogChannelName(index: number): string {
    return `${SYNTHETIC_TITLE_VOCABULARY.latin1.channel} ${SYNTHETIC_M3U_SEED}-${String(index).padStart(6, '0')}`;
}

export function createSyntheticM3uCatalogFixture(
    origin = 'http://127.0.0.1'
): SyntheticM3uFixture {
    const titles = SYNTHETIC_TITLE_VOCABULARY.latin1;
    const lines = new Array<string>(1 + SYNTHETIC_M3U_CATALOG_ENTRY_COUNT * 2);
    lines[0] = '#EXTM3U';
    let seriesIndex = 0;
    let episodeIndex = 0;

    for (
        let offset = 0;
        offset < SYNTHETIC_M3U_CATALOG_ENTRY_COUNT;
        offset += 1
    ) {
        const index = offset + 1;
        const stableIndex = String(index).padStart(6, '0');
        const kind =
            offset < SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES
                ? 'live'
                : offset <
                    SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES +
                        SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES
                  ? 'movie'
                  : 'series';
        let name: string;
        const groupIndex = kind === 'series' ? seriesIndex : offset;
        if (kind === 'series') {
            const titleId = String(
                (seriesIndex % SERIES_TITLE_COUNT) + 1
            ).padStart(5, '0');
            const year = seriesIndex < SERIES_TITLE_COUNT ? 2010 : 2020;
            const season = episodeIndex < FIRST_SEASON_EPISODES ? '01' : '02';
            const episode = seriesEpisodeNumber(episodeIndex);
            name = `Synthetic Series ${titleId} ${year} S${season}E${episode}`;
            episodeIndex += 1;
            const episodeCount =
                EPISODES_PER_SERIES +
                Number(seriesIndex < SERIES_WITH_EXTRA_EPISODE);
            if (episodeIndex === episodeCount) {
                seriesIndex += 1;
                episodeIndex = 0;
            }
        } else {
            name = syntheticM3uCatalogChannelName(index);
        }
        const group = String((groupIndex % CATALOG_GROUP_COUNT) + 1).padStart(
            3,
            '0'
        );
        const extension = kind === 'live' ? 'ts' : 'mp4';
        const lineOffset = 1 + offset * 2;

        lines[lineOffset] =
            `#EXTINF:-1 tvg-id="synthetic-${stableIndex}" tvg-name="${name}" ` +
            `tvg-logo="${origin}/logo/${SYNTHETIC_M3U_SEED}/${index}.png" ` +
            `group-title="${titles.group} ${group}",${name}`;
        lines[lineOffset + 1] =
            `${origin}/${kind}/${SYNTHETIC_M3U_SEED}/${index}.${extension}`;
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

function seriesEpisodeNumber(episodeIndex: number): string {
    const number =
        episodeIndex < FIRST_SEASON_EPISODES
            ? episodeIndex + 1
            : episodeIndex - FIRST_SEASON_EPISODES + 1;
    return String(number).padStart(2, '0');
}
