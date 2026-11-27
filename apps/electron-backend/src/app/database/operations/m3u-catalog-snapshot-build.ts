import type { Channel } from '@iptvnator/shared/interfaces';
import {
    classifyM3uEntry,
    M3U_CLASSIFIER_VERSION,
    M3U_KIND_CODES,
    type M3uCatalogSnapshot,
} from '@iptvnator/shared/m3u-utils/catalog';
import { buildM3uSeriesCatalogInBatches } from '@iptvnator/shared/m3u-utils/series';

type PositionedChannel = Channel & { position: number };

export function* buildM3uCatalogSnapshot(
    channels: readonly Channel[],
    playlistId: string,
    itemsRevision: number
): Generator<void, M3uCatalogSnapshot> {
    const snapshot: M3uCatalogSnapshot = {
        version: 1,
        classifierVersion: M3U_CLASSIFIER_VERSION,
        itemsRevision,
        counts: { live: 0, movie: 0, episode: 0, radio: 0 },
        groups: [],
        kinds: '',
        series: [],
    };
    const episodeRows: PositionedChannel[] = [];
    const groups = new Map<string, M3uCatalogSnapshot['groups'][number]>();
    const kindChunks: string[] = [];
    for (let start = 0; start < channels.length; start += 2048) {
        let kinds = '';
        const end = Math.min(start + 2048, channels.length);
        for (let position = start; position < end; position++) {
            const channel = channels[position];
            const kind = classifyM3uEntry(channel);
            kinds += M3U_KIND_CODES[kind];
            snapshot.counts[kind]++;
            const name = channel.group?.title ?? '';
            const key = M3U_KIND_CODES[kind] + name;
            let group = groups.get(key);
            if (!group) {
                group = { kind, name, count: 0, firstPosition: position };
                groups.set(key, group);
                snapshot.groups.push(group);
            }
            group.count++;
            if (kind === 'episode') episodeRows.push({ ...channel, position });
        }
        kindChunks.push(kinds);
        yield;
    }
    snapshot.kinds = kindChunks.join('');

    const seriesCatalog = yield* buildM3uSeriesCatalogInBatches(
        episodeRows,
        playlistId
    );
    let processed = 0;
    for (const { seasons, episodeCount, ...series } of seriesCatalog) {
        const positions: number[] = [];
        const seasonEntries: M3uCatalogSnapshot['series'][number]['seasonEntries'] =
            [];
        for (const [season, episodes] of seasons) {
            const entries = [];
            for (const { channel, alternatives, ...episode } of episodes) {
                const alternativePositions: number[] = [];
                positions.push(channel.position);
                for (const { position } of alternatives) {
                    alternativePositions.push(position);
                    positions.push(position);
                    if (++processed % 2048 === 0) yield;
                }
                entries.push({
                    ...episode,
                    position: channel.position,
                    alternatives: alternativePositions,
                });
                if (++processed % 2048 === 0) yield;
            }
            seasonEntries.push([season, entries]);
        }
        snapshot.series.push({
            ...series,
            seasons: seasons.size,
            episodes: episodeCount,
            positions,
            seasonEntries,
        });
    }
    return snapshot;
}
