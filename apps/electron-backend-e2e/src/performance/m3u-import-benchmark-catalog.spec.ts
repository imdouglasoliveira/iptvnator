import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createM3uImportIterationDefinitions,
    createM3uImportScenarioFixture,
    isM3uImportCatalogRun,
    listM3uImportScenarios,
    M3U_IMPORT_SCENARIO_ID,
} from './m3u-import-benchmark-contract';

describe('opt-in provider-shaped catalog scenario', () => {
    it('runs only when IPTVNATOR_PERF_M3U_CATALOG is 1', () => {
        assert.equal(isM3uImportCatalogRun({}), false);
        assert.equal(isM3uImportCatalogRun({ IPTVNATOR_PERF_M3U_CATALOG: '0' }), false);
        assert.equal(isM3uImportCatalogRun({ IPTVNATOR_PERF_M3U_CATALOG: '1' }), true);
    });

    it('replaces the formal scenarios with the 380k catalog and a longer settle window', () => {
        assert.deepEqual(listM3uImportScenarios({ catalog: true }), [
            {
                channelCount: 380_000,
                id: M3U_IMPORT_SCENARIO_ID.IMPORT_CATALOG_380K,
                settleTimeoutMs: 900_000,
            },
        ]);
        assert.deepEqual(
            listM3uImportScenarios().map(({ id }) => id),
            [
                M3U_IMPORT_SCENARIO_ID.IMPORT_10K,
                M3U_IMPORT_SCENARIO_ID.IMPORT_50K,
                M3U_IMPORT_SCENARIO_ID.IMPORT_100K,
            ]
        );
    });

    it('schedules a smoke catalog run as warm-up, one measured run and the diagnostic', () => {
        const definitions = createM3uImportIterationDefinitions(true, {
            catalog: true,
        });

        assert.deepEqual(
            definitions.map(({ runId, settleTimeoutMs }) => ({
                runId,
                settleTimeoutMs,
            })),
            [
                { runId: 'warmup-01', settleTimeoutMs: 900_000 },
                { runId: 'run-01', settleTimeoutMs: 900_000 },
                { runId: 'diagnostic', settleTimeoutMs: 900_000 },
            ]
        );
        assert.equal(createM3uImportIterationDefinitions(false).length, 21);
    });

    it('serves the catalog fixture for the catalog scenario only', () => {
        const [catalog] = listM3uImportScenarios({ catalog: true });
        const [formal] = listM3uImportScenarios();

        assert.equal(
            createM3uImportScenarioFixture(catalog).sha256,
            '2d2028bb6f11354f2ee91f4c5006abb607a440d4c9a58f22cfa334a8dbe551bf'
        );
        assert.equal(createM3uImportScenarioFixture(formal).channelCount, 10_000);
    });
});
