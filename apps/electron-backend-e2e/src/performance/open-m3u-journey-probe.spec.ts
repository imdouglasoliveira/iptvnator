import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';

import type { RendererPerformancePhase } from '@iptvnator/shared/logging';

import { installFakePerformance } from './journey-renderer-probe.test-helpers';
import {
    createOpenM3uJourneyProbeOptions,
    openM3uJourneyProbeScript,
    type OpenM3uJourneyProbeState,
} from './open-m3u-journey-probe';

function fixture(t: TestContext) {
    const options = createOpenM3uJourneyProbeOptions(
        '/workspace/playlists/synthetic/all'
    );
    const dom = new JSDOM('<button data-test-id="source">Open</button>', {
        pretendToBeVisual: true,
        runScripts: 'outside-only',
        url: 'https://example.test/workspace/dashboard',
    });
    const { window } = dom;
    t.after(() => window.close());
    installFakePerformance(window, []);
    Object.defineProperty(window, '__name', { value: (value: unknown) => value });
    const bridgeCalls: string[] = [];
    Object.defineProperty(window, 'electron', {
        value: {
            [options.sentinelMethod]: (id: string) => {
                bridgeCalls.push(id);
                return Promise.resolve();
            },
        },
    });
    window.eval(
        `(${openM3uJourneyProbeScript.toString()})(${JSON.stringify({
            ...options,
            clickSelector: '[data-test-id="source"]',
        })})`
    );
    const globals = window as unknown as Record<PropertyKey, unknown>;
    const state = globals[options.stateKey] as OpenM3uJourneyProbeState;
    const hook = globals[Symbol.for(options.phaseHookKey)] as (
        event: unknown
    ) => void;
    return {
        bridgeCalls,
        options,
        state,
        click: () => window.document.querySelector('button')?.click(),
        navigate: () => window.history.pushState(null, '', options.pathname),
        phase: (phase: RendererPerformancePhase, items: number) =>
            hook({
                boundary: 'end',
                metadata: { items },
                outcome: 'success',
                phase,
            }),
        show: (html: string) => {
            window.document.querySelector('main')?.remove();
            window.document.body.insertAdjacentHTML('beforeend', html);
        },
    };
}

const favorite =
    '<div data-test-id="channel-item"><button class="favorite-button" aria-pressed="true"></button></div>';
const regular =
    '<div data-test-id="channel-item"><button class="favorite-button" aria-pressed="false"></button></div>';

test('J5 sees a favorite before the full list and counts builds only inside the opening', async (t) => {
    const { bridgeCalls, click, navigate, options, phase, show, state } =
        fixture(t);
    phase('store.m3u-build-catalog-index', 380_000);
    click();
    navigate();
    phase('store.m3u-build-catalog-index', 0);
    phase('store.m3u-publish-favorites', 3);
    show(`<main class="workspace-content">${favorite}</main>`);
    await Promise.resolve();
    const firstChannelMs = state.firstChannelMs;
    assert.ok(firstChannelMs !== null);
    assert.equal(state.firstFavoriteMs, firstChannelMs);
    assert.deepEqual({ fullListMs: state.fullListMs }, { fullListMs: null });

    phase('store.m3u-publish-channels', 380_000);
    phase('store.m3u-build-catalog-index', 380_000);
    show(`<main class="workspace-content"><div id="all-channels">${regular}</div></main>`);
    await Promise.resolve();
    assert.ok(state.fullListMs !== null && state.fullListMs >= firstChannelMs);
    assert.equal(state.catalogBuildsOnOpen, 1);
    assert.deepEqual(bridgeCalls, [options.startSentinelId, options.sentinelId]);
    phase('store.m3u-build-catalog-index', 380_000);
    assert.equal(state.catalogBuildsOnOpen, 1);
});

test('J5 keeps its terminal pending for unrelated routes, partial publishes and favorite-only rows', async (t) => {
    const { click, navigate, phase, show, state } = fixture(t);
    click();
    show(`<main class="workspace-content"><div id="all-channels">${regular}</div></main>`);
    await Promise.resolve();
    assert.equal(state.firstChannelMs, null);

    navigate();
    phase('store.m3u-publish-channels', 3);
    show(`<main class="workspace-content"><div id="all-channels">${regular}</div></main>`);
    await Promise.resolve();
    assert.equal(state.fullListMs, null);

    phase('store.m3u-publish-channels', 380_000);
    phase('store.m3u-publish-favorites', 3);
    show(`<main class="workspace-content"><div id="all-channels">${favorite}</div></main>`);
    await Promise.resolve();
    assert.notEqual(state.firstFavoriteMs, null);
    assert.equal(state.fullListMs, null);
});
