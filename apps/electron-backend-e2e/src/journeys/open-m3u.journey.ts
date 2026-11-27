import { test } from '@playwright/test';

import { startJourneyMockRequestLedger } from '../performance/journey-mock-request-ledger';
import type { JourneyIterationRecord } from '../performance/journey-summary';
import {
    OPEN_M3U_JOURNEY_ID,
    toOpenM3uIterationRecord,
} from '../performance/open-m3u-journey-record';
import { createSyntheticM3uCatalogFixture } from '../performance/synthetic-m3u-catalog';
import {
    startSyntheticM3uServer,
    SYNTHETIC_M3U_RESOURCE_PATH,
} from '../performance/synthetic-m3u-server';
import {
    JOURNEY_ITERATION_TIMEOUT_MS,
    JOURNEY_MEASURED_ITERATIONS,
    JOURNEY_WARMUP_ITERATIONS,
    logJourneyIteration,
    writeJourneyRunEntry,
} from './journey-run';
import {
    removeLaunchJourneyProfile,
    runLaunchJourney,
} from './launch-journey-app';
import {
    measureOpenM3uJourney,
    seedOpenM3uJourneyProfile,
} from './open-m3u-journey-app';

test('J5 opens the synthetic M3U catalog', async () => {
    test.skip(process.env['IPTVNATOR_JOURNEY_OPEN_M3U'] !== '1', 'J5 is opt-in');
    const server = await startSyntheticM3uServer(createSyntheticM3uCatalogFixture);
    const iterations: JourneyIterationRecord[] = [];
    let electronVersion = 'unknown';
    try {
        const ledger = await startJourneyMockRequestLedger(server.origin);
        try {
            const { directory, pathname } = await seedOpenM3uJourneyProfile(
                ledger.origin + SYNTHETIC_M3U_RESOURCE_PATH,
                JOURNEY_ITERATION_TIMEOUT_MS
            );
            try {
                const total =
                    JOURNEY_WARMUP_ITERATIONS + JOURNEY_MEASURED_ITERATIONS;
                for (let index = 0; index < total; index += 1) {
                    const { launch, continuation } = await runLaunchJourney(
                        directory,
                        JOURNEY_ITERATION_TIMEOUT_MS,
                        { idleWindowMs: null, mainCounters: false },
                        (session) =>
                            measureOpenM3uJourney(
                                session,
                                ledger,
                                pathname,
                                JOURNEY_ITERATION_TIMEOUT_MS
                            )
                    );
                    electronVersion = launch.electronVersion;
                    const record = toOpenM3uIterationRecord(
                        index,
                        index < JOURNEY_WARMUP_ITERATIONS,
                        launch.pid,
                        continuation
                    );
                    iterations.push(record);
                    logJourneyIteration(OPEN_M3U_JOURNEY_ID, record);
                }
            } finally {
                await removeLaunchJourneyProfile(directory);
            }
        } finally {
            await ledger.close();
        }
    } finally {
        await server.close();
    }
    await writeJourneyRunEntry(
        OPEN_M3U_JOURNEY_ID,
        iterations,
        {},
        electronVersion
    );
});
