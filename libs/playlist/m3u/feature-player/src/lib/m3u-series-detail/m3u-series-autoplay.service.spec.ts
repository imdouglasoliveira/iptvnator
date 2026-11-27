import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { SettingsStore } from '@iptvnator/services';
import type {
    Channel,
    PlaybackPositionData,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { buildM3uSeriesCatalog } from '@iptvnator/shared/m3u-utils/series';
import { M3uEpisodeAccessService } from './m3u-episode-access.service';
import { toSeasonRecord } from './m3u-series-episode.adapter';
import { M3uSeriesPositionsService } from './m3u-series-positions.service';
import type { M3uSeriesAutoplayService } from './m3u-series-autoplay.service';
import type { AutoplayStreakService } from '@iptvnator/ui/playback';
import { M3uSeriesExternalAutoplay } from './m3u-series-external-autoplay';

jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

const [series] = buildM3uSeriesCatalog(
    ['S01E01', 'S01E02', 'S02E01'].map(
        (label) =>
            ({
                name: `Example Show ${label}`,
                url: `https://streams.example/series/${label}.mp4`,
                group: { title: 'Example Shows' },
            }) as Channel
    ),
    'example-playlist'
);
const seasons = toSeasonRecord(series);
const [first, second] = seasons['1'];
const [third] = seasons['2'];

describe('M3uSeriesAutoplayService', () => {
    let serviceType: typeof M3uSeriesAutoplayService;

    beforeAll(async () => {
        ({ M3uSeriesAutoplayService: serviceType } =
            await import('./m3u-series-autoplay.service'));
    });

    function setup(current = first) {
        const seriesAutoplay = signal(true);
        const playback = signal<ResolvedPortalPlayback | null>({
            streamUrl: current.direct_source,
            title: current.title,
            contentInfo: {
                playlistId: 'example-playlist',
                contentType: 'episode',
                contentXtreamId: Number(current.id),
                seasonNumber: current.season,
                episodeNumber: current.episode_num,
            },
        });
        const mountEpisode = jest.fn();
        const isWithheld = jest.fn(() => false);
        const requestAccess = jest.fn(async () => true);
        TestBed.configureTestingModule({
            providers: [
                serviceType,
                {
                    provide: M3uSeriesExternalAutoplay,
                    useValue: { connect: jest.fn(), release: jest.fn() },
                },
                { provide: SettingsStore, useValue: { seriesAutoplay } },
                {
                    provide: PORTAL_PLAYER,
                    useValue: { isEmbeddedPlayer: () => true },
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
            ],
        });
        const service = TestBed.inject(serviceType);
        service.connect({
            playback,
            seasons: signal(seasons),
            playbackPositions: signal(new Map<number, PlaybackPositionData>()),
            series: signal(series),
            visibleSeries: signal(series),
            seriesId: signal(series.id),
            playlistId: signal('example-playlist'),
            playbackPlaylist: signal(null),
            sessionKeyOf: (id) => String(id),
            mountEpisode,
            closePlayer: jest.fn(),
        });
        return {
            service,
            seriesAutoplay,
            mountEpisode,
            isWithheld,
            requestAccess,
            streak: (service as unknown as { streak: AutoplayStreakService })
                .streak,
        };
    }

    it('plays the next episode when the current episode ends', async () => {
        const { service, mountEpisode, streak } = setup();

        expect(service.episodeMetadata()?.label).toBe('S01E01');
        await service.onPlaybackEnded();

        expect(mountEpisode).toHaveBeenCalledTimes(1);
        expect(mountEpisode).toHaveBeenCalledWith(
            expect.objectContaining({ episode: second })
        );
        expect(streak.length).toBe(1);
    });

    it('plays the first episode of the next season through the shared rail', async () => {
        const { service, mountEpisode, streak } = setup(second);
        const [current, next] = service.upNextEpisodes();

        expect(current).toMatchObject({ label: 'S01E02', isPlaying: true });
        expect(next).toMatchObject({ label: 'S02E01', isPlaying: false });
        expect(service.seriesNavigation()?.canNext).toBe(false);
        await service.onPlaybackEnded();
        expect(mountEpisode).not.toHaveBeenCalled();

        streak.beginAutoplay();
        await service.onUpNextSelected({
            ...next,
            autoplaySignal: new AbortController().signal,
        });

        expect(mountEpisode).toHaveBeenCalledTimes(1);
        expect(mountEpisode).toHaveBeenCalledWith(
            expect.objectContaining({ episode: third })
        );
        expect(streak.length).toBe(1);
    });

    it('does not autoplay when series autoplay is off', async () => {
        const { service, seriesAutoplay, mountEpisode, streak } = setup();
        seriesAutoplay.set(false);

        expect(service.seriesNavigation()).toMatchObject({
            canNext: true,
            autoplayEnabled: false,
        });
        await service.onPlaybackEnded();

        expect(mountEpisode).not.toHaveBeenCalled();
        expect(streak.length).toBe(0);
    });

    it.each(['playback ended', 'season advance'])(
        'keeps the current episode when the PIN is cancelled after %s',
        async (trigger) => {
            const seasonAdvance = trigger === 'season advance';
            const { service, mountEpisode, isWithheld, requestAccess, streak } =
                setup(seasonAdvance ? second : first);
            isWithheld.mockReturnValue(true);
            requestAccess.mockResolvedValue(false);

            if (seasonAdvance) {
                streak.beginAutoplay();
                await service.onUpNextSelected({
                    ...service.upNextEpisodes()[1],
                    autoplaySignal: new AbortController().signal,
                });
            } else {
                await service.onPlaybackEnded();
            }

            expect(requestAccess).toHaveBeenCalledTimes(1);
            expect(mountEpisode).not.toHaveBeenCalled();
            expect(streak.length).toBe(0);
        }
    );

    it('resets the autoplay streak on a manual episode choice', async () => {
        const { service, mountEpisode, streak } = setup(second);
        streak.beginAutoplay();
        streak.playbackStarted();

        await service.onUpNextSelected(service.upNextEpisodes()[1]);

        expect(mountEpisode).toHaveBeenCalledWith(
            expect.objectContaining({ episode: third })
        );
        expect(streak.length).toBe(0);
    });

    it('ignores a PIN grant after the player aborts a season advance', async () => {
        const { service, mountEpisode, isWithheld, requestAccess, streak } =
            setup(second);
        const controller = new AbortController();
        let grantAccess!: (granted: boolean) => void;
        isWithheld.mockReturnValue(true);
        requestAccess.mockReturnValue(
            new Promise<boolean>((resolve) => (grantAccess = resolve))
        );
        streak.beginAutoplay();
        controller.signal.addEventListener('abort', () =>
            streak.cancelAutoplay()
        );

        const selection = service.onUpNextSelected({
            ...service.upNextEpisodes()[1],
            autoplaySignal: controller.signal,
        });
        controller.abort();
        grantAccess(true);
        await selection;

        expect(mountEpisode).not.toHaveBeenCalled();
        expect(streak.length).toBe(0);
    });
});
