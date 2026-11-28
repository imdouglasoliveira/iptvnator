import { Channel } from '@iptvnator/shared/interfaces';
import { M3uSeries } from '@iptvnator/shared/m3u-utils/series';

/**
 * The series an episode row belongs to: the row is matched by id and URL,
 * as the player's channel handoff matches it, falling back to the URL alone
 * when the playlist was refreshed under a stale id.
 */
export function findM3uSeriesOfEpisode(
    series: readonly M3uSeries<Channel>[],
    url: string,
    id: string
): M3uSeries<Channel> | undefined {
    let byUrl: M3uSeries<Channel> | undefined;
    for (const entry of series) {
        for (const episodes of entry.seasons.values()) {
            for (const episode of episodes) {
                for (const row of [episode.channel, ...episode.alternatives]) {
                    if (row.url !== url) {
                        continue;
                    }
                    if (!id || row.id === id) {
                        return entry;
                    }
                    byUrl ??= entry;
                }
            }
        }
    }
    return byUrl;
}
