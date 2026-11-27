import {
    computed,
    DestroyRef,
    inject,
    Injectable,
    signal,
    type Signal,
} from '@angular/core';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import type { PlaybackFallbackRequest } from '@iptvnator/playback/util';
import { SettingsStore } from '@iptvnator/services';
import {
    VideoPlayer,
    type Channel,
    type ExternalPlaybackEnded,
    type PlaybackPositionData,
    type PlaylistMeta,
    type ResolvedPortalPlayback,
    type XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import type { M3uSeries } from '@iptvnator/shared/m3u-utils/series';
import {
    AutoplayStreakService,
    buildUpNextRailItems,
    getSeriesEpisodeMetadata,
    getSeriesPlaybackNavigation,
    inlineSeriesEpisodeState,
    type UpNextRailItem,
} from '@iptvnator/ui/playback';
import { buildM3uPlaybackPayload } from '../m3u-playback-payload.util';
import { M3uEpisodeAccessService } from './m3u-episode-access.service';
import { m3uEpisodeStaysInline } from './m3u-episode-player-override.util';
import { resumeOffsetOf } from './m3u-episode-resume.util';
import {
    channelOfM3uEpisode,
    toSeasonRecord,
    type M3uSeasonRecord,
} from './m3u-series-episode.adapter';
import {
    m3uEpisodeContentInfo,
    M3uSeriesExternalAutoplay,
} from './m3u-series-external-autoplay';
import { M3uSeriesPositionsService } from './m3u-series-positions.service';

export interface PlayingEpisode {
    readonly episode: XtreamSerieEpisode;
    readonly channel: Channel;
    readonly startTime: number | undefined;
}

interface PlaybackBindings {
    playback: Signal<ResolvedPortalPlayback | null>;
    seasons: Signal<M3uSeasonRecord>;
    playbackPositions: Signal<ReadonlyMap<number, PlaybackPositionData>>;
    series: () => M3uSeries<Channel> | undefined;
    visibleSeries: Signal<M3uSeries<Channel> | undefined>;
    seriesId: Signal<number>;
    playlistId: Signal<string>;
    playbackPlaylist: Signal<PlaylistMeta | null>;
    sessionKeyOf: (episodeId: number) => string;
    mountEpisode: (playing: PlayingEpisode) => void;
    closePlayer: () => void;
}

interface EpisodeOpenOptions {
    fromStart?: boolean;
    automatic?: boolean;
    autoplaySignal?: AbortSignal;
    vlcContinuationSessionId?: string;
}

@Injectable()
export class M3uSeriesAutoplayService {
    private readonly access = inject(M3uEpisodeAccessService);
    private readonly positions = inject(M3uSeriesPositionsService);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly settings = inject(SettingsStore);
    private readonly streak = inject(AutoplayStreakService);
    private readonly external = inject(M3uSeriesExternalAutoplay);
    private readonly page = signal<PlaybackBindings | null>(null);
    private pending: EpisodeOpenOptions | null = null;
    private readonly autoplayEnabled = computed(
        () => this.settings.seriesAutoplay?.() !== false
    );
    private readonly fullSeries = computed(() => this.page()?.series());
    private readonly visibleEpisodes = computed(
        () =>
            new Map(
                (
                    [] as (readonly [
                        XtreamSerieEpisode['id'],
                        XtreamSerieEpisode,
                    ])[]
                ).concat(
                    ...Object.values(this.page()?.seasons() ?? {}).map(
                        (episodes: XtreamSerieEpisode[]) =>
                            episodes.map(
                                (episode) => [episode.id, episode] as const
                            )
                    )
                )
            )
    );
    private readonly playbackSeasons = computed(() => {
        const page = this.page();
        const series = this.fullSeries();
        if (!page || !series) return null;
        if (series === page.visibleSeries()) return page.seasons();

        const visible = this.visibleEpisodes();
        const seasons = toSeasonRecord(series);
        for (const [key, episodes] of Object.entries(seasons)) {
            seasons[key] = episodes.map(
                (episode) => visible.get(episode.id) ?? episode
            );
        }
        return seasons;
    });

    readonly episodeState = computed(() =>
        inlineSeriesEpisodeState(
            this.page()?.playback() ?? null,
            this.playbackSeasons()
        )
    );
    readonly seriesNavigation = computed(() =>
        getSeriesPlaybackNavigation(this.episodeState(), this.autoplayEnabled())
    );
    readonly episodeMetadata = computed(() =>
        getSeriesEpisodeMetadata(this.episodeState())
    );
    readonly upNextEpisodes = computed(() => {
        const items = buildUpNextRailItems({
            episodesBySeason: this.playbackSeasons(),
            currentEpisodeId: this.episodeState()?.episode.id,
            playbackPositions: this.page()?.playbackPositions(),
        });
        const visible = this.visibleEpisodes();
        if (!items[0] || !visible.has(items[0].episode.id)) return [];

        // Keep an anonymous successor so the shared player can request its PIN.
        return items
            .map((item, index): UpNextRailItem<XtreamSerieEpisode>[] => {
                if (visible.has(item.episode.id)) return [item];
                if (index !== 1) return [];
                const { id, season, episode_num, seasonUnknown } = item.episode;
                return [
                    {
                        ...item,
                        title: '',
                        thumbnailUrl: null,
                        progressPercent: null,
                        episode: {
                            id,
                            season,
                            episode_num,
                            seasonUnknown,
                            title: '',
                            info: [],
                            container_extension: '',
                            custom_sid: '',
                            added: '',
                            direct_source: '',
                        },
                    },
                ];
            })
            .reduce<UpNextRailItem<XtreamSerieEpisode>[]>(
                (all, part) => all.concat(part),
                []
            );
    });

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            this.cancelPending();
            this.page.set(null);
        });
    }

    connect(page: PlaybackBindings): void {
        this.page.set(page);
        this.external.connect(
            (event) => this.onExternalPlaybackEnded(event),
            () => this.streak.playbackStarted()
        );
    }

    leaveSeries(): void {
        this.cancelPending();
        this.external.release();
    }

    openFallback(
        request: PlaybackFallbackRequest,
        playing: PlayingEpisode | null
    ): void {
        this.cancelPending();
        this.streak.reset();
        const page = this.page();
        if (page && playing)
            this.access.recordWhenPlayed(
                page.playlistId(),
                playing.channel,
                null
            );
        request.trackLaunch(
            this.external.open(request.playback, request.player, true)
        );
    }

    private onExternalPlaybackEnded(
        event: ExternalPlaybackEnded
    ): Promise<void> | void {
        const page = this.page();
        const { contentInfo, sessionId } = event;
        if (
            !page ||
            this.pending ||
            contentInfo.playlistId !== page.playlistId() ||
            contentInfo.seriesXtreamId !== page.seriesId() ||
            !this.autoplayEnabled()
        )
            return;

        const [, next] = buildUpNextRailItems({
            episodesBySeason: this.playbackSeasons(),
            currentEpisodeId: contentInfo.contentXtreamId,
            limit: 2,
        });
        if (!next || !this.streak.beginAutoplay()) return;
        return this.openEpisode(next.episode, {
            automatic: true,
            vlcContinuationSessionId: sessionId,
        });
    }

    onPlaybackEnded(): Promise<void> | void {
        const next = this.episodeState()?.next;
        if (
            !next ||
            this.pending ||
            !this.seriesNavigation()?.autoplayEnabled ||
            !this.streak.beginAutoplay()
        ) {
            return;
        }
        return this.openEpisode(next, { automatic: true });
    }

    playNext(): void {
        const next = this.episodeState()?.next;
        if (next) void this.openEpisode(next);
    }

    playPrevious(): void {
        const previous = this.episodeState()?.previous;
        if (previous) void this.openEpisode(previous);
    }

    onUpNextSelected(
        item: UpNextRailItem & { autoplaySignal?: AbortSignal }
    ): Promise<void> {
        return this.openEpisode(item.episode as XtreamSerieEpisode, {
            automatic: Boolean(item.autoplaySignal),
            autoplaySignal: item.autoplaySignal,
        });
    }

    cancelPending(): void {
        const request = this.pending;
        this.pending = null;
        // The shared player releases its own claim when it aborts the signal.
        if (request?.automatic && !request.autoplaySignal?.aborted) {
            this.streak.cancelAutoplay();
        }
    }

    async openEpisode(
        episode: XtreamSerieEpisode,
        options: EpisodeOpenOptions = {}
    ): Promise<void> {
        const page = this.page();
        if (!page || options.autoplaySignal?.aborted) return;

        this.cancelPending();
        const request = { ...options };
        this.pending = request;
        const playlistId = page.playlistId();
        const seriesId = page.seriesId();
        const continuation = request.vlcContinuationSessionId;
        const canOpen = () =>
            this.pending === request &&
            !request.autoplaySignal?.aborted &&
            playlistId === page.playlistId() &&
            seriesId === page.seriesId() &&
            (!continuation || this.external.owns(continuation)) &&
            (!request.automatic || this.autoplayEnabled());

        try {
            const positions = request.fromStart
                ? null
                : this.positions.whenLoaded();
            if (positions) await positions;
            if (!canOpen()) return;

            const channel =
                channelOfM3uEpisode(page.visibleSeries(), episode.id) ??
                channelOfM3uEpisode(this.fullSeries(), episode.id);
            if (!channel) return;

            if (this.access.isWithheld(playlistId, channel)) {
                const granted = await this.access.requestAccess(
                    playlistId,
                    channel
                );
                if (!granted || !canOpen()) return;
            }

            const external =
                (Boolean(continuation) ||
                    !this.portalPlayer.isEmbeddedPlayer()) &&
                !m3uEpisodeStaysInline(channel);
            if (request.automatic && external !== Boolean(continuation)) return;

            const startTime = request.fromStart
                ? undefined
                : resumeOffsetOf(
                      page.playbackPositions().get(Number(episode.id))
                  );
            this.pending = null;
            if (!request.automatic) this.streak.reset();
            await this.play(
                page,
                playlistId,
                { episode, channel, startTime },
                external,
                continuation
            );
        } finally {
            if (this.pending === request) this.cancelPending();
        }
    }

    private async play(
        page: PlaybackBindings,
        playlistId: string,
        playing: PlayingEpisode,
        external: boolean,
        continuation?: string
    ): Promise<void> {
        const { episode, channel, startTime } = playing;
        if (external) {
            page.closePlayer();
            this.access.recordWhenPlayed(playlistId, channel, null);
            const opened = await this.external.open(
                {
                    ...buildM3uPlaybackPayload({
                        channel,
                        target: channel,
                        playlistMeta: page.playbackPlaylist(),
                        isLive: false,
                        startTime,
                    }),
                    contentInfo: m3uEpisodeContentInfo(
                        playlistId,
                        page.seriesId(),
                        episode
                    ),
                    ...(continuation && {
                        vlcContinuationSessionId: continuation,
                    }),
                },
                continuation || this.settings.player?.() === VideoPlayer.VLC
                    ? 'vlc'
                    : undefined,
                Boolean(continuation)
            );
            if (continuation && !opened) this.streak.cancelAutoplay();
            return;
        }

        this.external.release();
        this.access.recordWhenPlayed(
            playlistId,
            channel,
            page.sessionKeyOf(Number(episode.id))
        );
        page.mountEpisode(playing);
    }
}
