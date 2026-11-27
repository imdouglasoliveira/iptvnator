import type { Channel, ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import {
    indexM3uCatalogRows,
    M3U_CLASSIFIER_VERSION,
    M3U_KIND_CODES,
    type M3uCatalogSnapshot,
    type M3uContentKind,
    type M3uSnapshotSeries,
} from '@iptvnator/shared/m3u-utils/catalog';
import type { M3uSeries } from '@iptvnator/shared/m3u-utils/series';

const kinds = Object.keys(M3U_KIND_CODES) as M3uContentKind[];
const kindByCode = new Map(kinds.map((kind) => [M3U_KIND_CODES[kind], kind]));

export async function readM3uCatalogSnapshot(
    bridge: Pick<ElectronBridgeApi, 'dbGetM3uCatalogSnapshot'>,
    playlistId: string,
    revision: number,
    channelCount: number
): Promise<M3uCatalogSnapshot | null> {
    try {
        const text = await bridge.dbGetM3uCatalogSnapshot?.(playlistId);
        if (text == null) return null;
        const data = JSON.parse(text);
        if (
            data?.itemsRevision !== revision ||
            data?.classifierVersion !== M3U_CLASSIFIER_VERSION
        )
            return null;
        if (isSnapshot(data, channelCount)) return data;
    } catch {
        // IPC errors and malformed data share the same safe fallback.
    }
    console.warn(
        redactSensitiveData({ event: 'm3u-catalog-snapshot-read-failed' })
    );
    return null;
}

function isSnapshot(value: M3uCatalogSnapshot, size: number): boolean {
    if (
        value.version !== 1 ||
        typeof value.kinds !== 'string' ||
        !Array.isArray(value.groups) ||
        !Array.isArray(value.series) ||
        !value.counts ||
        !kinds.every((kind) => isCount(value.counts[kind])) ||
        kinds.reduce((sum, kind) => sum + value.counts[kind], 0) !== size
    )
        return false;

    if (
        value.kinds !== '' &&
        (value.kinds.length !== size || /[^lmer]/.test(value.kinds))
    ) {
        return false;
    }
    const inRange = (position: number) => isCount(position) && position < size;
    return (
        value.groups.every(
            (group) =>
                group &&
                typeof group.name === 'string' &&
                kinds.includes(group.kind) &&
                isCount(group.count) &&
                inRange(group.firstPosition)
        ) && value.series.every((series) => validSeries(series, inRange))
    );
}

function isCount(value: unknown): value is number {
    return (
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    );
}

function validSeries(
    series: M3uSnapshotSeries,
    inRange: (position: number) => boolean
) {
    return (
        series &&
        isCount(series.id) &&
        typeof series.key === 'string' &&
        typeof series.title === 'string' &&
        typeof series.rawTitle === 'string' &&
        typeof series.primaryGroup === 'string' &&
        Array.isArray(series.groups) &&
        series.groups.every((group) => typeof group === 'string') &&
        isCount(series.episodes) &&
        Array.isArray(series.positions) &&
        series.positions.every(inRange) &&
        Array.isArray(series.seasonEntries) &&
        series.seasonEntries.length === series.seasons &&
        series.seasonEntries.every(
            (entry) =>
                Array.isArray(entry) &&
                isCount(entry[0]) &&
                Array.isArray(entry[1]) &&
                entry[1].every(
                    (episode) =>
                        episode &&
                        isCount(episode.id) &&
                        inRange(episode.position) &&
                        isCount(episode.seasonNumber) &&
                        isCount(episode.episodeNumber) &&
                        Array.isArray(episode.alternatives) &&
                        episode.alternatives.every(inRange)
                )
        )
    );
}

export function indexFromM3uSnapshot(
    snapshot: M3uCatalogSnapshot,
    channels: readonly Channel[]
) {
    if (snapshot.kinds.length !== channels.length) return null;
    const index = indexM3uCatalogRows(channels, (_channel, position) =>
        kindByCode.get(
            snapshot.kinds[position] as (typeof M3U_KIND_CODES)[M3uContentKind]
        )!
    );
    return kinds.every((kind) => index.counts[kind] === snapshot.counts[kind])
        ? index
        : null;
}

export function seriesFromM3uSnapshot(
    snapshot: M3uCatalogSnapshot,
    channels: readonly Channel[]
): readonly M3uSeries<Channel>[] {
    return snapshot.series.map(
        ({
            seasonEntries,
            episodes,
            seasons: _seasons,
            positions: _positions,
            ...series
        }) => ({
            ...series,
            episodeCount: episodes,
            seasons: new Map(
                seasonEntries.map(([season, entries]) => [
                    season,
                    entries.map(({ position, alternatives, ...episode }) => ({
                        ...episode,
                        channel: channels[position],
                        alternatives: alternatives.map(
                            (alternative) => channels[alternative]
                        ),
                    })),
                ])
            ),
        })
    );
}
