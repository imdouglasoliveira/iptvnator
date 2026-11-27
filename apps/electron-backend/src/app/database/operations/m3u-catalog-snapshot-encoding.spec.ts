import type { M3uCatalogSnapshot } from '@iptvnator/shared/m3u-utils/catalog';
import { readM3uSnapshotChannels } from './m3u-catalog-snapshot-payload';
import {
    serializeM3uCatalogSnapshot,
    SNAPSHOT_BYTES_LIMIT,
} from './m3u-catalog-snapshot-serialization';

function finish<T>(task: Generator<void, T>): T {
    for (let step = task.next(); ; step = task.next()) {
        if (step.done) return step.value;
    }
}

const series = {
    key: 'synthetic',
    id: 1,
    title: 'Synthetic',
    rawTitle: 'Synthetic',
    languageTag: null,
    yearHint: null,
    primaryGroup: '',
    groups: [],
    posterUrl: null,
    seasons: 0,
    episodes: 0,
    positions: [],
    seasonEntries: [],
};

const snapshot: M3uCatalogSnapshot = {
    version: 1,
    classifierVersion: 1,
    itemsRevision: 4,
    counts: { live: 0, movie: 0, episode: 0, radio: 0 },
    kinds: '',
    groups: [],
    series: [series],
};

it('pauses while locating the channel array and recognizes escaped JSON keys and values', () => {
    const items = [
        { name: 'A "channel" with a backslash \\', extra: ['[', '}'] },
    ];
    const payload =
        '{"shadow":{"playlist":{"items":[]}},"padding":' +
        JSON.stringify('\u{1d11e}'.repeat(80_000)) +
        ',"\\u0070laylist":{"\\u0069tems":' +
        JSON.stringify(items) +
        '}}';
    const task = readM3uSnapshotChannels(payload);
    expect(task.next().done).toBe(false);
    expect(task.next().done).toBe(false);
    expect(finish(task)).toEqual(items);
});

it('rejects a malformed stored document after the channel array', () => {
    expect(() =>
        finish(readM3uSnapshotChannels('{"playlist":{"items":[]},"invalid":}'))
    ).toThrow(SyntaxError);
});

it('serializes large series in slices and preserves Unicode at slice boundaries', () => {
    const title = 'x'.repeat(65_535) + '\u{1d11e}"' + 'z'.repeat(65_536);
    const input = { ...snapshot, series: [{ ...series, title }] };
    const task = serializeM3uCatalogSnapshot(input);
    expect(task.next().done).toBe(false);
    expect(JSON.parse(finish(task)!)).toEqual(input);
});

it('keeps the series when only the optional index puts the JSON over the byte cap', () => {
    const input: M3uCatalogSnapshot = {
        ...snapshot,
        kinds: 'l',
        groups: [
            {
                kind: 'live',
                name: 'é'.repeat(SNAPSHOT_BYTES_LIMIT / 2),
                count: 1,
                firstPosition: 0,
            },
        ],
    };
    const encoded = finish(serializeM3uCatalogSnapshot(input))!;
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(SNAPSHOT_BYTES_LIMIT);
    expect(JSON.parse(encoded)).toEqual(snapshot);
});

it('rejects a snapshot when the final JSON with series alone exceeds the byte cap', () => {
    const title = 'é'.repeat(SNAPSHOT_BYTES_LIMIT / 2);
    expect(
        finish(
            serializeM3uCatalogSnapshot({
                ...snapshot,
                series: [{ ...series, title }],
            })
        )
    ).toBeUndefined();
});
