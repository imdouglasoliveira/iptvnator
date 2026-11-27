import type { M3uContentKind } from './m3u-content-kind.util';
import type { M3uSeries, M3uSeriesEpisode } from './m3u-series-model';

export const M3U_KIND_CODES = {
    live: 'l',
    movie: 'm',
    episode: 'e',
    radio: 'r',
} as const satisfies Record<M3uContentKind, string>;

export interface M3uSnapshotGroup {
    name: string;
    kind: M3uContentKind;
    count: number;
    firstPosition: number;
}

export interface M3uSnapshotEpisode extends Omit<
    M3uSeriesEpisode<never>,
    'channel' | 'alternatives'
> {
    position: number;
    alternatives: number[];
}

export interface M3uSnapshotSeries extends Omit<
    M3uSeries<never>,
    'seasons' | 'episodeCount'
> {
    seasons: number;
    episodes: number;
    positions: number[];
    seasonEntries: [number, M3uSnapshotEpisode[]][];
}

export interface M3uCatalogSnapshot {
    version: 1;
    classifierVersion: number;
    itemsRevision: number;
    counts: Record<M3uContentKind, number>;
    groups: M3uSnapshotGroup[];
    kinds: string;
    series: M3uSnapshotSeries[] | null;
}
