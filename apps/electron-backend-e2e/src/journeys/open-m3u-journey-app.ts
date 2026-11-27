import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toggleFavoriteForChannel } from '../dashboard-e2e-flows';
import {
    closeElectronAppAndConfirmExit,
    expect,
    goToDashboard,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    waitForM3uCatalog,
} from '../electron-test-fixtures';
import {
    journeyActivityBeforeClick,
    waitForJourneyClickQuiet,
} from '../performance/journey-click-settle';
import {
    detachJourneyMainIpcCapture,
    installJourneyMainIpcCapture,
    JOURNEY_MAIN_IPC_STATE_KEY,
    JOURNEY_RENDERER_API_TRACE_CHANNEL,
    readJourneyMainIpcCapture,
} from '../performance/journey-main-ipc-capture';
import type { JourneyMockRequestLedger } from '../performance/journey-mock-request-ledger';
import {
    createOpenM3uJourneyProbeOptions,
    OPEN_M3U_JOURNEY_FAVORITE_COUNT,
    openM3uJourneyProbeScript,
    type OpenM3uJourneyProbeState,
} from '../performance/open-m3u-journey-probe';
import { syntheticM3uCatalogChannelName } from '../performance/synthetic-m3u-catalog';
import {
    journeyLaunchOptions,
    removeLaunchJourneyProfile,
    type LaunchJourneySession,
} from './launch-journey-app';

const ERROR_PREFIX = 'open-m3u-journey';
const IPC_STATE_KEY = '__iptvnatorOpenM3uJourneyMainIpcCapture';

export async function seedOpenM3uJourneyProfile(
    playlistUrl: string,
    timeoutMs: number
): Promise<{ directory: string; pathname: string }> {
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-journey-open-m3u-seed-')
    );
    try {
        const app = await launchElectronApp(directory, journeyLaunchOptions());
        try {
            const page = app.mainWindow;
            await importM3uPlaylistFromUrl(page, playlistUrl);
            await waitForM3uCatalog(page);
            const { pathname } = new URL(page.url());
            const playlistId = pathname.split('/').at(-2);
            if (!playlistId) {
                throw new Error('open-m3u-journey-seed-playlist-id-missing');
            }
            for (
                let index = 1;
                index <= OPEN_M3U_JOURNEY_FAVORITE_COUNT;
                index += 1
            ) {
                await toggleFavoriteForChannel(
                    page,
                    syntheticM3uCatalogChannelName(index)
                );
            }
            await expect
                .poll(
                    () =>
                        page.evaluate(async (id) => {
                            const readSnapshot =
                                window.electron.dbGetM3uFavoritesSnapshot;
                            if (readSnapshot) {
                                const snapshot = await readSnapshot(id);
                                return snapshot
                                    ? JSON.parse(snapshot).channels.length
                                    : 0;
                            }
                            const favorites =
                                await window.electron.dbGetAppPlaylistFavoriteChannels(
                                    id
                                );
                            return favorites.length;
                        }, playlistId),
                    { timeout: timeoutMs }
                )
                .toBe(OPEN_M3U_JOURNEY_FAVORITE_COUNT);
            await expect
                .poll(
                    () =>
                        page.evaluate(async (id) => {
                            const read =
                                window.electron.dbGetM3uCatalogSnapshot;
                            return read ? (await read(id)) !== null : true;
                        }, playlistId),
                    { timeout: timeoutMs }
                )
                .toBe(true);
            await goToDashboard(page);
            return { directory, pathname };
        } finally {
            await closeElectronAppAndConfirmExit(app);
        }
    } catch (error) {
        await removeLaunchJourneyProfile(directory);
        throw error;
    }
}

export async function measureOpenM3uJourney(
    { electronApp, mainWindow }: LaunchJourneySession,
    ledger: JourneyMockRequestLedger,
    pathname: string,
    timeoutMs: number
): Promise<OpenM3uJourneyProbeState> {
    const options = createOpenM3uJourneyProbeOptions(pathname);
    await mainWindow.waitForURL(/\/workspace\/dashboard$/, {
        timeout: timeoutMs,
    });
    await mainWindow.setViewportSize({ width: 1280, height: 800 });
    await installJourneyMainIpcCapture(electronApp, {
        channel: JOURNEY_RENDERER_API_TRACE_CHANNEL,
        sentinelId: options.sentinelId,
        sentinelMethod: options.sentinelMethod,
        startSentinelId: options.startSentinelId,
        stateKey: IPC_STATE_KEY,
    });
    await mainWindow.evaluate(openM3uJourneyProbeScript, options);
    const card = mainWindow.locator(options.clickSelector);
    await card.hover({ timeout: timeoutMs });
    const { settle, ledgerMark } = await waitForJourneyClickQuiet(
        electronApp,
        mainWindow,
        ledger,
        {
            errorPrefix: ERROR_PREFIX,
            ipcCaptureStateKey: IPC_STATE_KEY,
            probeStateKey: options.stateKey,
        }
    );
    await detachJourneyMainIpcCapture(electronApp, JOURNEY_MAIN_IPC_STATE_KEY);
    await card.click({ timeout: timeoutMs });
    const result = await mainWindow.waitForFunction(
        (key) => {
            const probe = (
                globalThis as unknown as Record<
                    string,
                    OpenM3uJourneyProbeState | undefined
                >
            )[key];
            return probe &&
                probe.clickMs !== null &&
                probe.firstChannelMs !== null &&
                probe.firstFavoriteMs !== null &&
                probe.fullListMs !== null
                ? probe
                : null;
        },
        options.stateKey,
        { timeout: timeoutMs }
    );
    const probe = await result.jsonValue();
    if (probe === null || probe.clickMs === null) {
        throw new Error('open-m3u-journey-probe-incomplete');
    }
    const ipc = await readJourneyMainIpcCapture(
        electronApp,
        IPC_STATE_KEY,
        10_000
    );
    const clickEpochMs = probe.timeOriginMs + probe.clickMs;
    const lateActivity = journeyActivityBeforeClick(settle, {
        httpAfterSettleBeforeClick: ledger
            .since(ledgerMark)
            .filter((request) => request.epochMs < clickEpochMs).length,
        ipcCallsBeforeStart: ipc.callsBeforeStart,
        preStartDomMutations: probe.preStart.domMutations,
    });
    if (lateActivity.length > 0) {
        throw new Error(
            `open-m3u-journey-activity-before-click-${lateActivity.join('-')}`
        );
    }
    return probe;
}
