import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    linkedSignal,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import {
    SettingsStore,
    tmdbBackdropUrl,
    tmdbPosterUrl,
} from '@iptvnator/services';
import { selectActivePlaylist } from '@iptvnator/m3u-state';
import { M3uSeriesCatalogService } from '@iptvnator/m3u-state/series-catalog';
import { Store } from '@ngrx/store';
import {
    DetailActionsTemplateDirective,
    DetailIconButtonComponent,
    DetailMetaTemplateDirective,
    PortalDetailShellComponent,
    SeasonContainerComponent,
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerSeriesPlaybackToggleRequest,
    VodMoreMenuComponent,
    favoriteIcon,
} from '@iptvnator/ui/components';
import {
    PortalInlinePlayerComponent,
    type UpNextRailItem,
} from '@iptvnator/ui/playback';
import {
    Channel,
    hasReachedPlaybackStart,
    PlaybackPositionUpdate,
    PlaylistMeta,
    ResolvedPortalPlayback,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { M3uSeries } from '@iptvnator/shared/m3u-utils/series';
import {
    createPlaybackSessionKey,
    type PlaybackFallbackRequest,
} from '@iptvnator/playback/util';
import {
    m3uEpisodeContentInfo,
    M3uSeriesExternalAutoplay,
} from './m3u-series-external-autoplay';
import { M3uSeriesExternalPositions } from './m3u-series-external-positions';
import { M3uCatalogFavoriteToggleService } from '../m3u-catalog/m3u-catalog-favorite-toggle.service';
import { buildM3uPlaybackPayload } from '../m3u-playback-payload.util';
import { readStoredM3uVolume } from '../m3u-stored-volume.util';
import { M3uEpisodeAccessService } from './m3u-episode-access.service';
import { m3uEpisodePlayerOverride } from './m3u-episode-player-override.util';
import {
    M3uSeriesAutoplayService,
    type PlayingEpisode,
} from './m3u-series-autoplay.service';
import { toSeasonRecord } from './m3u-series-episode.adapter';
import { M3uSeriesMenuService } from './m3u-series-menu.service';
import { M3uSeriesMetadataService } from './m3u-series-metadata.service';
import { M3uSeriesPositionsService } from './m3u-series-positions.service';

@Component({
    selector: 'app-m3u-series-detail-route',
    imports: [
        DetailActionsTemplateDirective,
        DetailIconButtonComponent,
        DetailMetaTemplateDirective,
        PortalDetailShellComponent,
        PortalInlinePlayerComponent,
        SeasonContainerComponent,
        TranslatePipe,
        VodMoreMenuComponent,
    ],
    templateUrl: './m3u-series-detail-route.component.html',
    providers: [
        M3uCatalogFavoriteToggleService,
        M3uEpisodeAccessService,
        M3uSeriesAutoplayService,
        M3uSeriesExternalAutoplay,
        M3uSeriesExternalPositions,
        M3uSeriesMenuService,
        M3uSeriesMetadataService,
        M3uSeriesPositionsService,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class M3uSeriesDetailRouteComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly catalog = inject(M3uSeriesCatalogService);
    private readonly positions = inject(M3uSeriesPositionsService);
    private readonly metadata = inject(M3uSeriesMetadataService);
    private readonly access = inject(M3uEpisodeAccessService);
    private readonly settingsStore = inject(SettingsStore);
    protected readonly autoplay = inject(M3uSeriesAutoplayService);
    protected readonly menu = inject(M3uSeriesMenuService);
    protected readonly favorite = inject(M3uCatalogFavoriteToggleService);
    protected readonly favoriteIcon = favoriteIcon;
    private readonly seasonContainer =
        viewChild<SeasonContainerComponent>('seasonContainer');

    private readonly playlist = this.store.selectSignal(selectActivePlaylist);

    // Keep the payload stable when a Recently viewed write republishes playlist metadata.
    private readonly playbackPlaylist = computed<PlaylistMeta | null>(
        () => {
            const playlist = this.playlist();
            return playlist
                ? ({
                      _id: playlist._id,
                      userAgent: playlist.userAgent,
                      referrer: playlist.referrer,
                      origin: playlist.origin,
                  } as PlaylistMeta)
                : null;
        },
        {
            equal: (a, b) =>
                a?._id === b?._id &&
                a?.userAgent === b?.userAgent &&
                a?.referrer === b?.referrer &&
                a?.origin === b?.origin,
        }
    );

    protected readonly seriesId = toSignal(
        this.route.paramMap.pipe(
            map((params) => Number(params.get('seriesId') ?? ''))
        ),
        { initialValue: 0 }
    );

    protected readonly series = computed<M3uSeries<Channel> | undefined>(() =>
        this.catalog.seriesById().get(this.seriesId())
    );

    protected readonly playlistId = computed(() => this.playlist()?._id ?? '');

    protected readonly seasons = computed(() => {
        const series = this.series();
        return series ? toSeasonRecord(series) : {};
    });

    protected readonly seasonCount = computed(
        () => Object.keys(this.seasons()).length
    );

    protected readonly episodeCount = computed(
        () => this.series()?.episodeCount ?? 0
    );

    // Capture the episode and its resume offset once to avoid re-seeking on progress ticks.
    private readonly playing = signal<PlayingEpisode | null>(null);
    /** Latches once the mounted episode reaches its resume point. */
    private resumeSettled = false;

    protected readonly playingEpisodeId = computed(() => {
        const id = Number(this.playing()?.episode.id ?? '');
        return Number.isFinite(id) && id > 0 ? id : null;
    });

    /** DASH and DRM episodes need an engine that can play them inline. */
    protected readonly playerOverride = computed(() =>
        m3uEpisodePlayerOverride(
            this.playing()?.channel,
            this.settingsStore.player()
        )
    );

    protected readonly playback = computed<ResolvedPortalPlayback | null>(
        () => {
            const playing = this.playing();
            if (!playing) {
                return null;
            }
            const channel = playing.channel;

            return {
                ...buildM3uPlaybackPayload({
                    channel,
                    target: channel,
                    playlistMeta: this.playbackPlaylist(),
                    isLive: false,
                    startTime: playing.startTime,
                }),
                // The episode identity enables the fullscreen episode panel.
                contentInfo: m3uEpisodeContentInfo(
                    this.playlistId(),
                    this.seriesId(),
                    playing.episode
                ),
            };
        }
    );

    // Changing this key remounts the engine.
    protected readonly playbackSessionKey = computed(() =>
        this.sessionKeyOf(this.playingEpisodeId())
    );

    private readonly tmdb = computed(() => this.metadata.state().details);

    protected readonly seriesTitle = computed(
        () => this.tmdb()?.name?.trim() || this.series()?.title || ''
    );

    protected readonly overview = computed(
        () => this.tmdb()?.overview?.trim() ?? ''
    );

    protected readonly backdropUrl = computed(
        () => tmdbBackdropUrl(this.tmdb()?.backdrop_path) ?? undefined
    );

    /** Watch progress the shared season grid renders as badges and bars. */
    protected readonly playbackPositions = this.positions.byEpisodeId;
    protected readonly watchBatchRunning = this.positions.toggleRunning;

    constructor() {
        this.menu.connect(this.seasonContainer);
        this.autoplay.connect({
            playback: this.playback,
            seasons: this.seasons,
            playbackPositions: this.playbackPositions,
            series: () => this.catalog.seriesForPlayback(this.seriesId()),
            visibleSeries: this.series,
            seriesId: this.seriesId,
            playlistId: this.playlistId,
            playbackPlaylist: this.playbackPlaylist,
            sessionKeyOf: (episodeId) => this.sessionKeyOf(episodeId),
            mountEpisode: (playing) => {
                this.resumeSettled = false;
                this.playing.set(playing);
                this.positions.releaseProgressThrottle();
            },
            closePlayer: () => this.onPlayerClosed(),
        });

        effect(() => {
            const playlistId = this.playlistId();
            const seriesId = this.seriesId();
            untracked(() => {
                void this.favorite.load(playlistId, 'series', seriesId);
            });
        });

        // Catalog rebuilds must not re-read positions or release the progress throttle.
        effect(() => {
            const playlistId = this.playlistId();
            const seriesId = this.seriesId();
            untracked(() => {
                const key = `${playlistId}\u0000${seriesId}`;
                if (key !== this.shownSeriesKey) {
                    this.shownSeriesKey = key;
                    this.autoplay.leaveSeries();
                    this.playing.set(null);
                }
                void this.positions.load(playlistId, seriesId);
            });
        });

        effect(() => {
            const series = this.series();
            untracked(() => {
                if (series) {
                    this.metadata.load(series);
                } else {
                    this.metadata.reset();
                }
            });
        });

        // Check the mounted row for relocks even while the catalog is reloading.
        effect(() => {
            this.access.lockVersion();
            const playing = this.playing();
            untracked(() => {
                if (
                    playing &&
                    this.access.isWithheld(this.playlistId(), playing.channel)
                ) {
                    this.onPlayerClosed();
                }
            });
        });
    }

    protected onFavoriteToggled(): void {
        void this.favorite.toggle({
            playlistId: this.playlistId(),
            type: 'series',
            stableId: this.seriesId(),
            title: this.seriesTitle(),
            posterUrl: this.posterUrl() ?? null,
            backdropUrl: this.backdropUrl() ?? null,
        });
    }

    /** One episode's toggle, or the menu's season or series batch. */
    protected onWatchToggled(
        request:
            | SeasonContainerPlaybackToggleRequest
            | SeasonContainerSeriesPlaybackToggleRequest
    ): void {
        void this.positions.applyToggle(
            this.playlistId(),
            this.seriesId(),
            request
        );
    }

    protected onTimeUpdate(update: PlaybackPositionUpdate): void {
        const playing = this.playing();
        const episode = playing?.episode;
        if (!episode || !Number.isFinite(update.currentTime)) {
            return;
        }
        // Ignore initial ticks until the engine seeks to the saved point.
        if (!this.resumeSettled) {
            if (!hasReachedPlaybackStart(update, playing.startTime ?? 0)) {
                return;
            }
            this.resumeSettled = true;
        }

        void this.positions.recordProgress(
            this.playlistId(),
            {
                contentXtreamId: Number(episode.id),
                contentType: 'episode',
                seriesXtreamId: this.seriesId(),
                seasonNumber: episode.season,
                episodeNumber: episode.episode_num,
                positionSeconds: Math.floor(update.currentTime),
                durationSeconds: Number.isFinite(update.duration)
                    ? Math.floor(update.duration)
                    : undefined,
                playlistId: this.playlistId(),
            },
            update.playing === false || update.checkpoint === true
        );
    }

    protected readonly posterUrl = computed(
        () =>
            tmdbPosterUrl(this.tmdb()?.poster_path) ??
            this.series()?.posterUrl ??
            undefined
    );

    // Restore the last M3U volume when opening another episode.
    protected readonly volume = linkedSignal({
        source: () => this.playing(),
        computation: () => readStoredM3uVolume(),
    });

    protected onExternalFallbackRequested(
        request: PlaybackFallbackRequest
    ): void {
        this.autoplay.openFallback(request, this.playing());
    }

    protected onPanelEpisodeSelected(
        item: UpNextRailItem & { autoplaySignal?: AbortSignal }
    ): void {
        void this.autoplay.onUpNextSelected(item);
    }

    private shownSeriesKey = '';

    /** "Play from beginning" on an episode with saved progress. */
    protected onEpisodeRestartRequested(episode: XtreamSerieEpisode): void {
        void this.autoplay.openEpisode(episode, { fromStart: true });
    }

    protected onEpisodeClicked(episode: XtreamSerieEpisode): void {
        void this.autoplay.openEpisode(episode);
    }

    /** The playback session of one episode, scoped to its playlist. */
    private sessionKeyOf(episodeId: number | null): string {
        return createPlaybackSessionKey({
            kind: 'episode',
            sourceId: this.playlistId(),
            contentId: episodeId ?? 'none',
            seriesId: this.seriesId(),
        });
    }

    protected onPlayerClosed(): void {
        this.autoplay.cancelPending();
        this.playing.set(null);
        this.positions.releaseProgressThrottle();
    }

    protected onBack(): void {
        // Navigate from the playlist route to avoid appending a second series segment.
        void this.router.navigate(['series'], {
            relativeTo: this.route.parent,
        });
    }
}
