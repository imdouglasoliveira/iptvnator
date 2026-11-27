import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { DataService, SettingsStore } from '@iptvnator/services';
import {
    VideoPlayer,
    type Channel,
    type ExternalPlaybackEnded,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { buildM3uSeriesCatalog } from '@iptvnator/shared/m3u-utils/series';
import { M3uEpisodeAccessService } from './m3u-episode-access.service';
import type { M3uSeriesAutoplayService } from './m3u-series-autoplay.service';
import { toSeasonRecord } from './m3u-series-episode.adapter';
import { M3uSeriesExternalAutoplay } from './m3u-series-external-autoplay';
import { M3uSeriesExternalPositions } from './m3u-series-external-positions';
import { M3uSeriesPositionsService } from './m3u-series-positions.service';

jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

const playlistId = 'synthetic-playlist';
const [series] = buildM3uSeriesCatalog(
    ['S01E01', 'S01E02', 'S02E01'].map(
        (label) =>
            ({
                name: `Synthetic Show ${label}`,
                url: `https://streams.example.test/${label}.mp4`,
                group: { title: 'Synthetic Shows' },
            }) as Channel
    ),
    playlistId
);
const seasons = toSeasonRecord(series);
let serviceType: typeof M3uSeriesAutoplayService;

beforeAll(async () => {
    ({ M3uSeriesAutoplayService: serviceType } =
        await import('./m3u-series-autoplay.service'));
});

async function setup(first = seasons['1'][0]) {
    let receive!: (event: ExternalPlaybackEnded) => void;
    const openResolvedPlayback = jest.fn().mockResolvedValue({
        id: 'first-session',
        status: 'opened',
    });
    const openExternalPlayback = jest.fn().mockResolvedValue({
        id: 'next-session',
        status: 'opened',
    });
    const isWithheld = jest.fn().mockReturnValue(false);
    const requestAccess = jest.fn().mockResolvedValue(false);
    const complete = jest.fn().mockResolvedValue(undefined);
    const seriesAutoplay = signal(true);
    TestBed.configureTestingModule({
        providers: [
            serviceType,
            M3uSeriesExternalAutoplay,
            {
                provide: SettingsStore,
                useValue: { seriesAutoplay, player: signal(VideoPlayer.VLC) },
            },
            {
                provide: PORTAL_PLAYER,
                useValue: {
                    isEmbeddedPlayer: () => false,
                    openExternalPlayback,
                    openResolvedPlayback,
                },
            },
            {
                provide: DataService,
                useValue: {
                    onExternalPlaybackEnded: (callback: typeof receive) => {
                        receive = callback;
                        return jest.fn();
                    },
                },
            },
            {
                provide: M3uEpisodeAccessService,
                useValue: {
                    isWithheld,
                    requestAccess,
                    recordWhenPlayed: jest.fn(),
                },
            },
            {
                provide: M3uSeriesPositionsService,
                useValue: { whenLoaded: () => null },
            },
            {
                provide: M3uSeriesExternalPositions,
                useValue: { connect: jest.fn(), release: jest.fn(), complete },
            },
        ],
    });
    const service = TestBed.inject(serviceType);
    service.connect({
        playback: signal(null),
        seasons: signal(seasons),
        playbackPositions: signal(new Map()),
        series: signal(series),
        visibleSeries: signal(series),
        seriesId: signal(series.id),
        playlistId: signal(playlistId),
        playbackPlaylist: signal(null),
        sessionKeyOf: String,
        mountEpisode: jest.fn(),
        closePlayer: jest.fn(),
    });
    await service.openEpisode(first);
    const [playback] = openResolvedPlayback.mock.calls[0] as [
        ResolvedPortalPlayback,
    ];
    const event = {
        sessionId: 'first-session',
        contentInfo: playback.contentInfo!,
        positionSeconds: 115,
        durationSeconds: 120,
    };
    return {
        event,
        receive,
        complete,
        openResolvedPlayback,
        openExternalPlayback,
        isWithheld,
        requestAccess,
        seriesAutoplay,
    };
}

it.each([
    [seasons['1'][0], seasons['1'][1]],
    [seasons['1'][1], seasons['2'][0]],
])(
    'advances a finished episode on its exact VLC session',
    async (first, next) => {
        const { event, receive, complete, openExternalPlayback } =
            await setup(first);
        expect(event.contentInfo).toMatchObject({
            playlistId,
            contentXtreamId: Number(first.id),
            seriesXtreamId: series.id,
            m3uSeries: true,
        });
        receive({ ...event, sessionId: 'unrelated' });
        expect(openExternalPlayback).not.toHaveBeenCalled();
        receive(event);
        receive(event);
        expect(complete).toHaveBeenCalledTimes(1);
        expect(openExternalPlayback).toHaveBeenCalledTimes(1);
        expect(openExternalPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                vlcContinuationSessionId: 'first-session',
                contentInfo: expect.objectContaining({
                    contentXtreamId: Number(next.id),
                }),
            }),
            'vlc'
        );
    }
);

it('requests the next episode PIN before sending anything to VLC', async () => {
    const { event, receive, isWithheld, requestAccess, openExternalPlayback } =
        await setup();
    isWithheld.mockReturnValue(true);
    receive(event);
    expect(requestAccess).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(openExternalPlayback).not.toHaveBeenCalled();
});

it('marks the episode when autoplay is turned off', async () => {
    const { event, receive, complete, seriesAutoplay, openExternalPlayback } =
        await setup();
    seriesAutoplay.set(false);
    receive(event);
    expect(complete).toHaveBeenCalledWith(event);
    expect(openExternalPlayback).not.toHaveBeenCalled();
});
