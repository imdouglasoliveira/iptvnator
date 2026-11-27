import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarizeJourneyIterations } from './journey-summary';
import { toOpenM3uIterationRecord } from './open-m3u-journey-record';

const probe = {
    clickMs: 100,
    firstChannelMs: 150,
    firstFavoriteMs: 150,
    fullListMs: 500,
    catalogBuildsOnOpen: 1,
};

test('J5 summarizes both click boundaries and excludes warm-up from the median', () => {
    const warmup = toOpenM3uIterationRecord(0, true, 123, {
        ...probe,
        fullListMs: 900,
        catalogBuildsOnOpen: 2,
    });
    const measured = toOpenM3uIterationRecord(1, false, 124, probe);
    const summary = summarizeJourneyIterations([warmup, measured], {});

    assert.deepEqual(summary.counters, { 'renderer.catalogBuildsOnOpen': 1 });
    assert.equal(summary.wallClock['clickToFirstChannelMs.p50'], 50);
    assert.equal(summary.wallClock['clickToFirstFavoriteMs.p50'], 50);
    assert.equal(summary.wallClock['clickToFullListMs.p50'], 400);
    assert.deepEqual(summary.unavailable, {});
});

test('J5 accepts zero builds when opening a snapshot', () => {
    const record = toOpenM3uIterationRecord(0, false, 123, {
        ...probe,
        catalogBuildsOnOpen: 0,
    });
    assert.equal(record.counters['renderer.catalogBuildsOnOpen'], 0);
});

test('J5 rejects missing and invalid boundaries or counts', () => {
    for (const invalid of [
        { clickMs: null },
        { firstChannelMs: null },
        { firstFavoriteMs: null },
        { fullListMs: null },
        { firstChannelMs: 99 },
        { firstFavoriteMs: 149 },
        { fullListMs: Number.NaN },
        { catalogBuildsOnOpen: -1 },
    ]) {
        assert.throws(
            () =>
                toOpenM3uIterationRecord(0, false, 123, {
                    ...probe,
                    ...invalid,
                }),
            /open-m3u-journey-record/
        );
    }
});
