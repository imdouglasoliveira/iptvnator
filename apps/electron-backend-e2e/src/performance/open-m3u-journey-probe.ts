import {
    RENDERER_PERFORMANCE_PHASE,
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
} from '@iptvnator/shared/logging';

import { JOURNEY_IPC_SENTINEL_METHOD } from './journey-renderer-probe';
import { SYNTHETIC_M3U_CATALOG_ENTRY_COUNT } from './synthetic-m3u-catalog';

export const OPEN_M3U_JOURNEY_FAVORITE_COUNT = 3;

export function createOpenM3uJourneyProbeOptions(pathname: string) {
    return {
        pathname,
        channelSelector: 'main.workspace-content [data-test-id="channel-item"]',
        clickSelector: '[data-test-id="dashboard-recent-sources-rail-card-link"]',
        fullListContainer: '#all-channels',
        favoriteSelector: '.favorite-button[aria-pressed="true"]',
        regularSelector: '.favorite-button[aria-pressed="false"]',
        expectedChannels: SYNTHETIC_M3U_CATALOG_ENTRY_COUNT,
        expectedFavorites: OPEN_M3U_JOURNEY_FAVORITE_COUNT,
        phaseHookKey: RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
        phases: {
            build: RENDERER_PERFORMANCE_PHASE.M3U_BUILD_CATALOG_INDEX,
            channels: RENDERER_PERFORMANCE_PHASE.M3U_PUBLISH_CHANNELS,
            favorites: RENDERER_PERFORMANCE_PHASE.M3U_PUBLISH_FAVORITES,
        },
        sentinelId: '__iptvnator-open-m3u-end__',
        sentinelMethod: JOURNEY_IPC_SENTINEL_METHOD,
        startSentinelId: '__iptvnator-open-m3u-start__',
        stateKey: '__iptvnatorOpenM3uJourney',
    };
}

export interface OpenM3uJourneyProbeState {
    readonly timeOriginMs: number;
    readonly preStart: { domMutations: number };
    clickMs: number | null;
    firstChannelMs: number | null;
    firstFavoriteMs: number | null;
    fullListMs: number | null;
    catalogBuildsOnOpen: number;
}

// Playwright serializes this function into the renderer.
export function openM3uJourneyProbeScript(
    options: ReturnType<typeof createOpenM3uJourneyProbeOptions>
): void {
    const globals = globalThis as unknown as Record<PropertyKey, unknown>;
    const hookKey = Symbol.for(options.phaseHookKey);
    if (
        globals[hookKey] !== undefined ||
        globals[options.stateKey] !== undefined
    ) {
        throw new Error('open-m3u-journey-probe-already-armed');
    }
    const state: OpenM3uJourneyProbeState = {
        timeOriginMs: performance.timeOrigin,
        preStart: { domMutations: 0 },
        clickMs: null,
        firstChannelMs: null,
        firstFavoriteMs: null,
        fullListMs: null,
        catalogBuildsOnOpen: 0,
    };
    globals[options.stateKey] = state;
    let channelsPublished = false;
    let favoritesPublished = false;

    const sendSentinel = (id: string) => {
        const bridge = globals['electron'] as
            | Record<string, unknown>
            | undefined;
        const method = bridge?.[options.sentinelMethod];
        if (typeof method !== 'function') {
            throw new Error('open-m3u-journey-probe-sentinel-bridge-missing');
        }
        void Promise.resolve(method.call(bridge, id)).catch(() => undefined);
    };
    const observer = new MutationObserver((records) => {
        if (state.clickMs === null) {
            state.preStart.domMutations += records.length;
            return;
        }
        if (location.pathname !== options.pathname) {
            return;
        }
        const rows = Array.from(
            document.querySelectorAll(options.channelSelector)
        ).filter((row) => {
            const { visibility } = getComputedStyle(row);
            return (
                row.getClientRects().length > 0 &&
                visibility !== 'hidden' &&
                visibility !== 'collapse'
            );
        });
        const now = performance.now();
        if (rows.length > 0) {
            state.firstChannelMs ??= now;
        }
        if (
            favoritesPublished &&
            rows.some((row) => row.querySelector(options.favoriteSelector))
        ) {
            state.firstFavoriteMs ??= now;
        }
        if (
            channelsPublished &&
            rows.some(
                (row) =>
                    row.closest(options.fullListContainer) &&
                    row.querySelector(options.regularSelector)
            )
        ) {
            state.fullListMs ??= now;
        }
        if (state.firstFavoriteMs !== null && state.fullListMs !== null) {
            observer.disconnect();
            delete globals[hookKey];
            sendSentinel(options.sentinelId);
        }
    });
    globals[hookKey] = (event: RendererPerformancePhaseEvent) => {
        if (
            state.clickMs === null ||
            event.boundary !== 'end' ||
            event.outcome !== 'success'
        ) {
            return;
        }
        const items = event.metadata?.items;
        if (
            event.phase === options.phases.channels &&
            items === options.expectedChannels
        ) {
            channelsPublished = true;
        }
        if (
            event.phase === options.phases.favorites &&
            items === options.expectedFavorites
        ) {
            favoritesPublished = true;
        }
        if (
            event.phase === options.phases.build &&
            items !== undefined &&
            items > 0 &&
            state.fullListMs === null
        ) {
            state.catalogBuildsOnOpen += 1;
        }
    };
    observer.observe(document, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
    });
    const onClick = (event: MouseEvent) => {
        if (
            !(event.target instanceof Element) ||
            !event.target.closest(options.clickSelector)
        ) {
            return;
        }
        document.removeEventListener('click', onClick, true);
        state.preStart.domMutations += observer.takeRecords().length;
        const now = performance.now();
        state.clickMs =
            event.timeStamp > 0 ? Math.min(event.timeStamp, now) : now;
        sendSentinel(options.startSentinelId);
    };
    document.addEventListener('click', onClick, true);
}
