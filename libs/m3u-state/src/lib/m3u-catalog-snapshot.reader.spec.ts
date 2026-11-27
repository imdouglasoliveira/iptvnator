import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { SettingsStore } from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import {
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
} from '@iptvnator/shared/logging';
import {
    buildM3uCatalogIndex,
    M3U_CLASSIFIER_VERSION,
} from '@iptvnator/shared/m3u-utils/catalog';
import { buildM3uSeriesCatalog } from '@iptvnator/shared/m3u-utils/series';
import {
    M3uCatalogIndexService,
    selectChannelsPlaylistId,
} from './m3u-catalog-index.service';
import { M3uSeriesCatalogService } from './m3u-series-catalog.service';
import { selectActivePlaylistId, selectChannelsLoading } from './selectors';

jest.mock('@iptvnator/shared/m3u-utils/catalog', () => {
    const actual = jest.requireActual('@iptvnator/shared/m3u-utils/catalog');
    return {
        ...actual,
        buildM3uCatalogIndex: jest.fn(actual.buildM3uCatalogIndex),
    };
});

jest.mock('@iptvnator/shared/m3u-utils/series', () => {
    const actual = jest.requireActual('@iptvnator/shared/m3u-utils/series');
    return {
        ...actual,
        buildM3uSeriesCatalog: jest.fn(actual.buildM3uSeriesCatalog),
    };
});

const playlistId = 'synthetic';
const revision = 7;
const channels = [
    { name: 'TV', url: 'https://example.test/channel.ts' },
    { name: 'Radio', url: 'https://example.test/radio', radio: 'true' },
    { name: 'Film', url: 'https://example.test/movie/1.mp4' },
    {
        name: 'Sample S01E01',
        url: 'https://example.test/series/1.mp4',
        group: { title: 'Shows' },
    },
] as Channel[];

function snapshotJson() {
    const [series] = buildM3uSeriesCatalog([channels[3]], playlistId);
    const { seasons, episodeCount, ...metadata } = series;
    const [episode] = seasons.get(1) ?? [];
    const {
        channel: _channel,
        alternatives: _alternatives,
        ...details
    } = episode;
    return {
        version: 1,
        classifierVersion: M3U_CLASSIFIER_VERSION,
        itemsRevision: revision,
        counts: { live: 1, radio: 1, movie: 1, episode: 1 },
        kinds: 'lrme',
        groups: [
            { name: '', kind: 'live', count: 1, firstPosition: 0 },
            { name: '', kind: 'radio', count: 1, firstPosition: 1 },
            { name: '', kind: 'movie', count: 1, firstPosition: 2 },
            { name: 'Shows', kind: 'episode', count: 1, firstPosition: 3 },
        ],
        series: [
            {
                ...metadata,
                seasons: 1,
                episodes: episodeCount,
                positions: [3],
                seasonEntries: [
                    [1, [{ ...details, position: 3, alternatives: [] }]],
                ],
            },
        ],
    };
}

describe('M3U catalog snapshot reader', () => {
    const read = jest.fn();
    const rows = signal<Channel[]>([]);
    const originalBridge = Object.getOwnPropertyDescriptor(window, 'electron');
    const optIn = signal(true);
    let payload: ReturnType<typeof snapshotJson>;

    beforeEach(() => {
        rows.set([]);
        optIn.set(true);
        payload = snapshotJson();
        jest.clearAllMocks();
        read.mockResolvedValue(JSON.stringify(payload));
        setBridge({ dbGetM3uCatalogSnapshot: read });
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: SettingsStore,
                    useValue: {
                        optimizations: () => ({ catalogSnapshot: optIn() }),
                    },
                },
                {
                    provide: Store,
                    useValue: {
                        selectSignal: (selector: unknown) => {
                            if (selector === selectChannelsLoading)
                                return signal(false);
                            if (
                                selector === selectActivePlaylistId ||
                                selector === selectChannelsPlaylistId
                            ) {
                                return signal(playlistId);
                            }
                            return rows;
                        },
                    },
                },
            ],
        });
    });

    afterEach(() => {
        if (originalBridge)
            Object.defineProperty(window, 'electron', originalBridge);
        else Reflect.deleteProperty(window, 'electron');
    });

    function setBridge(value: object) {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value,
        });
    }

    async function open() {
        const index = TestBed.inject(M3uCatalogIndexService);
        await index.prepareSnapshot(playlistId, revision, channels);
        rows.set(channels);
        return index;
    }

    it('includes radio in live order and skips both renderer builders', async () => {
        const index = await open();
        expect(index.liveChannels()).toEqual(channels.slice(0, 2));
        expect(index.index().counts).toEqual(payload.counts);
        expect(
            TestBed.inject(M3uSeriesCatalogService)
                .series()[0]
                .seasons.get(1)?.[0].channel
        ).toBe(channels[3]);
        expect(buildM3uCatalogIndex).not.toHaveBeenCalled();
        expect(buildM3uSeriesCatalog).not.toHaveBeenCalled();
    });

    it.each([
        ['different items revision', { itemsRevision: revision - 1 }],
        ['different classifier', { classifierVersion: -1 }],
        ['invalid kinds', { kinds: '????' }],
    ])('builds locally for %s', async (_name, override) => {
        read.mockResolvedValue(JSON.stringify({ ...payload, ...override }));
        expect((await open()).liveChannels()).toEqual(channels.slice(0, 2));
        expect(buildM3uCatalogIndex).toHaveBeenCalledTimes(1);
    });

    it.each([null, '{'])(
        'builds locally when snapshot data is %p',
        async (data) => {
            read.mockResolvedValue(data);
            expect((await open()).index().counts).toEqual(payload.counts);
            expect(buildM3uCatalogIndex).toHaveBeenCalledTimes(1);
        }
    );

    it('skips reads when the Electron kill switch hides the capability', async () => {
        setBridge({});
        expect(
            TestBed.inject(M3uCatalogIndexService).prepareSnapshot(
                playlistId,
                revision,
                channels
            )
        ).toBeUndefined();
        expect((await open()).index().counts).toEqual(payload.counts);
        expect(read).not.toHaveBeenCalled();
    });

    it('skips reads when catalog snapshots are disabled in settings', async () => {
        optIn.set(false);
        expect((await open()).index().counts).toEqual(payload.counts);
        expect(read).not.toHaveBeenCalled();
    });

    it('hydrates the catalog index without building when series was omitted by the size cap and builds series lazily', async () => {
        const globals = globalThis as unknown as Record<symbol, unknown>;
        const key = Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY);
        const events: RendererPerformancePhaseEvent[] = [];
        globals[key] = (event: RendererPerformancePhaseEvent) =>
            events.push(event);
        try {
            read.mockResolvedValue(JSON.stringify({ ...payload, series: null }));
            const index = await open();
            expect(index.liveChannels()).toEqual(channels.slice(0, 2));
            expect(index.index().counts).toEqual(payload.counts);
            expect(buildM3uCatalogIndex).not.toHaveBeenCalled();
            expect(
                events.filter(
                    (event) =>
                        event.boundary === 'end' &&
                        event.phase === 'store.m3u-build-catalog-index'
                )
            ).toEqual([]);
            expect(
                TestBed.inject(M3uSeriesCatalogService)
                    .series()[0]
                    .seasons.get(1)?.[0].channel
            ).toBe(channels[3]);
            expect(buildM3uSeriesCatalog).toHaveBeenCalledTimes(1);
        } finally {
            delete globals[key];
        }
    });

    it('does not reuse positions when a new array is published', async () => {
        const index = await open();
        rows.set([...channels].reverse());
        expect(index.liveChannels()).toEqual(channels.slice(0, 2).reverse());
        expect(buildM3uCatalogIndex).toHaveBeenCalledTimes(1);
    });
});
