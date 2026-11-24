import {
    PERFORMANCE_ITERATION_KIND,
    type PerformanceIterationKind,
} from './m3u-refresh-cancellation-contract';
import { SYNTHETIC_M3U_RESOURCE_PATH } from './synthetic-m3u-server';
import {
    createSyntheticM3uCatalogFixture,
    SYNTHETIC_M3U_CATALOG_ENTRY_COUNT,
} from './synthetic-m3u-catalog';
import {
    createSyntheticM3uFixture,
    type SyntheticM3uFixture,
} from './synthetic-m3u';

export const M3U_IMPORT_SCENARIO_ID = {
    IMPORT_10K: 'm3u-import-10k',
    IMPORT_50K: 'm3u-import-50k',
    IMPORT_100K: 'm3u-import-100k',
    IMPORT_CATALOG_380K: 'm3u-import-catalog-380k',
} as const;

export type M3uImportScenarioId =
    (typeof M3U_IMPORT_SCENARIO_ID)[keyof typeof M3U_IMPORT_SCENARIO_ID];

export interface M3uImportScenario {
    readonly channelCount: number;
    readonly id: M3uImportScenarioId;
    readonly settleTimeoutMs: number;
}

export interface M3uImportIterationDefinition {
    readonly channelCount: number;
    readonly kind: PerformanceIterationKind;
    readonly runId: string;
    readonly scenarioId: M3uImportScenarioId;
    readonly settleTimeoutMs: number;
}

export interface M3uImportScenarioOptions {
    /** Run only the provider-shaped 380k catalog (`IPTVNATOR_PERF_M3U_CATALOG=1`). */
    readonly catalog?: boolean;
}

const DEFAULT_SETTLE_TIMEOUT_MS = 120_000;
const CATALOG_SETTLE_TIMEOUT_MS = 900_000;

const SCENARIOS: readonly M3uImportScenario[] = Object.freeze([
    Object.freeze({
        channelCount: 10_000,
        id: M3U_IMPORT_SCENARIO_ID.IMPORT_10K,
        settleTimeoutMs: DEFAULT_SETTLE_TIMEOUT_MS,
    }),
    Object.freeze({
        channelCount: 50_000,
        id: M3U_IMPORT_SCENARIO_ID.IMPORT_50K,
        settleTimeoutMs: DEFAULT_SETTLE_TIMEOUT_MS,
    }),
    Object.freeze({
        channelCount: 100_000,
        id: M3U_IMPORT_SCENARIO_ID.IMPORT_100K,
        settleTimeoutMs: DEFAULT_SETTLE_TIMEOUT_MS,
    }),
]);

const CATALOG_SCENARIOS: readonly M3uImportScenario[] = Object.freeze([
    Object.freeze({
        channelCount: SYNTHETIC_M3U_CATALOG_ENTRY_COUNT,
        id: M3U_IMPORT_SCENARIO_ID.IMPORT_CATALOG_380K,
        settleTimeoutMs: CATALOG_SETTLE_TIMEOUT_MS,
    }),
]);

/**
 * Database-worker sample deadline for the main capture. A 380k import keeps the
 * worker busy for minutes, so the catalog waits as long as its settle window;
 * the formal scenarios keep the shared 5 s deadline.
 */
export function m3uImportWorkerSampleDeadlineMs(
    definition: M3uImportIterationDefinition
): number {
    return definition.scenarioId === M3U_IMPORT_SCENARIO_ID.IMPORT_CATALOG_380K
        ? CATALOG_SETTLE_TIMEOUT_MS
        : 5_000;
}

export function isM3uImportCatalogRun(
    env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
    return env['IPTVNATOR_PERF_M3U_CATALOG'] === '1';
}

export function listM3uImportScenarios(
    options: M3uImportScenarioOptions = {}
): readonly M3uImportScenario[] {
    return options.catalog ? CATALOG_SCENARIOS : SCENARIOS;
}

export function createM3uImportScenarioFixture(
    scenario: M3uImportScenario
): SyntheticM3uFixture {
    return scenario.id === M3U_IMPORT_SCENARIO_ID.IMPORT_CATALOG_380K
        ? createSyntheticM3uCatalogFixture()
        : createSyntheticM3uFixture(scenario.channelCount);
}

export function createM3uImportIterationDefinitions(
    smoke: boolean,
    options: M3uImportScenarioOptions = {}
): readonly M3uImportIterationDefinition[] {
    const measuredRuns = smoke ? 1 : 5;
    const definitions: M3uImportIterationDefinition[] = [];

    for (const scenario of listM3uImportScenarios(options)) {
        definitions.push(
            iteration(scenario, PERFORMANCE_ITERATION_KIND.WARMUP, 'warmup-01')
        );
        for (let index = 1; index <= measuredRuns; index += 1) {
            definitions.push(
                iteration(
                    scenario,
                    PERFORMANCE_ITERATION_KIND.MEASURED,
                    `run-${String(index).padStart(2, '0')}`
                )
            );
        }
        definitions.push(
            iteration(
                scenario,
                PERFORMANCE_ITERATION_KIND.DIAGNOSTIC,
                'diagnostic'
            )
        );
    }

    return Object.freeze(definitions);
}

export function assertSyntheticM3uImportUrl(value: string): void {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw invalidSyntheticUrl();
    }

    if (
        url.protocol !== 'http:' ||
        url.hostname !== '127.0.0.1' ||
        url.port.length === 0 ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.pathname !== SYNTHETIC_M3U_RESOURCE_PATH ||
        url.search.length > 0 ||
        url.hash.length > 0
    ) {
        throw invalidSyntheticUrl();
    }
}

function iteration(
    scenario: M3uImportScenario,
    kind: PerformanceIterationKind,
    runId: string
): M3uImportIterationDefinition {
    return Object.freeze({
        channelCount: scenario.channelCount,
        kind,
        runId,
        scenarioId: scenario.id,
        settleTimeoutMs: scenario.settleTimeoutMs,
    });
}

function invalidSyntheticUrl(): Error {
    return new Error(
        'M3U performance fixture must use the exact synthetic HTTP loopback URL'
    );
}
