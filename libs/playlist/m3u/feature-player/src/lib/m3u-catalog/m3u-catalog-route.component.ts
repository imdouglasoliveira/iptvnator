import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    linkedSignal,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { selectActivePlaylist } from '@iptvnator/m3u-state';
import { M3uCatalogIndexService } from '@iptvnator/m3u-state/catalog-index';
import { M3uSeriesCatalogService } from '@iptvnator/m3u-state/series-catalog';
import {
    OPEN_M3U_CHANNEL_ID_STATE_KEY,
    OPEN_M3U_CHANNEL_URL_STATE_KEY,
} from '@iptvnator/portal/shared/util';
import {
    CategoryViewComponent,
    GridListComponent,
    InfiniteScrollDirective,
    PortalEmptyStateComponent,
} from '@iptvnator/portal/shared/ui';
import { SettingsStore } from '@iptvnator/services';
import { Channel, foldSearchText } from '@iptvnator/shared/interfaces';
import { M3uContentKind } from '@iptvnator/shared/m3u-utils/catalog';
import {
    M3uCatalogCard,
    duplicateM3uSeriesTitles,
    toM3uCatalogCard,
    toM3uSeriesCard,
} from './m3u-catalog-card.util';
import { M3uCatalogFavoriteIdsService } from './m3u-catalog-favorite-ids.service';
import {
    M3U_FAVORITES_GROUP_ID,
    initialCatalogGroup,
    m3uFavoriteCards,
    withFavoritesGroup,
} from './m3u-catalog-favorites-group.util';
import { M3uCatalogViewMemory } from './m3u-catalog-view-memory';
import { findM3uSeriesOfEpisode } from './m3u-series-of-episode.util';

/** How many cards are rendered before the first scroll append. */
const INITIAL_WINDOW = 60;
const WINDOW_STEP = 60;

interface CatalogGroup {
    readonly title: string;
    readonly count: number;
}

/**
 * The Movies and Series sections of an M3U playlist.
 *
 * One component serves both; the kind arrives as route data. The layout
 * mirrors the portal catalogs on purpose — a group rail on the left, a
 * poster grid on the right — so an M3U playlist with films browses the same
 * way an Xtream one does.
 *
 * The two kinds differ in what a card IS. Movies are rows, and a card opens
 * the player. Series are aggregates, and a card opens a detail page — the
 * Series section shows a few thousand shows rather than the tens of
 * thousands of episode rows they are made of, which is the entire point of
 * aggregating them.
 *
 * This is a full-page route rather than a tab inside the channel-list
 * container, and deliberately so: a poster grid shares nothing with that
 * container's resizable-rail and virtual-scroll machinery, and both files it
 * would have to grow are already over the size limit.
 */
@Component({
    selector: 'app-m3u-catalog-route',
    imports: [
        CategoryViewComponent,
        GridListComponent,
        InfiniteScrollDirective,
        PortalEmptyStateComponent,
        TranslatePipe,
    ],
    providers: [M3uCatalogFavoriteIdsService],
    templateUrl: './m3u-catalog-route.component.html',
    styleUrls: ['./m3u-catalog-route.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class M3uCatalogRouteComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly catalog = inject(M3uCatalogIndexService);
    private readonly seriesCatalog = inject(M3uSeriesCatalogService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly favoriteIds = inject(M3uCatalogFavoriteIdsService);
    private readonly playlist =
        inject(Store).selectSignal(selectActivePlaylist);

    /**
     * Groups the viewer hid in the Groups view. The rail leaves them out, as
     * that view does; search still spans the whole section, as the channel
     * list's own search does — hiding is a preference, not a lock.
     */
    private readonly hiddenGroups = computed(
        () => new Set(this.playlist()?.hiddenGroupTitles ?? [])
    );
    private readonly translate = inject(TranslateService);

    /** `movie` or `episode`, supplied by the route definition. */
    protected readonly kind = signal<M3uContentKind>(
        (this.route.snapshot.data['kind'] as M3uContentKind) ?? 'movie'
    );

    protected readonly isSeries = computed(() => this.kind() === 'episode');

    private readonly memory = inject(M3uCatalogViewMemory);
    private readonly playlistRouteId =
        this.route.snapshot.paramMap?.get('id') ?? '';

    /** The view left for a detail page, until the grid is back to apply it. */
    private readonly restore = signal(
        this.memory.recall(this.playlistRouteId, this.kind())
    );

    /** An episode named by navigation state: its series page opens instead. */
    private readonly episodeHandoff = signal(
        this.kind() === 'episode' ? this.readEpisodeHandoff() : null
    );

    /**
     * A load in flight is not an empty section: the rows are on their way,
     * so the grid shows its skeleton rather than "no movies".
     */
    protected readonly loading = this.catalog.loading;

    /**
     * The workspace header owns search for this route's `local-filter`
     * mode and publishes it as `?q=`, so the component reads it rather than
     * rendering a second search box.
     */
    protected readonly searchTerm = toSignal(
        this.route.queryParamMap.pipe(map((params) => params.get('q') ?? '')),
        { initialValue: '' }
    );

    protected readonly selectedGroup = signal<string | null>(
        this.restore()?.group ?? null
    );

    /**
     * Names the visible set: the playlist, the section, the group and the
     * search. The playlist is part of it because the component is reused
     * across playlists, and two of them can share a group name.
     */
    private readonly visibleSetKey = computed(
        () =>
            `${this.catalog.rowsPlaylistId()}\u0000${this.kind()}\u0000${this.selectedGroup()}\u0000${this.searchTerm()}`
    );

    /**
     * The render window resets whenever the visible set changes, so a
     * viewer who scrolled deep into one group does not land mid-way down
     * the next one.
     */
    private readonly windowSize = linkedSignal({
        source: this.visibleSetKey,
        computation: () => INITIAL_WINDOW,
    });

    private readonly contentPane =
        viewChild<ElementRef<HTMLElement>>('contentPane');

    /**
     * The pane's own scroll position has to go back with the window. A
     * shorter window alone leaves `scrollTop` where it was, and the next
     * group opens near the bottom of its first page instead of at its
     * first card.
     */
    private readonly scrollReset = effect(() => {
        this.visibleSetKey();
        const pane = untracked(this.contentPane)?.nativeElement;
        if (pane && !untracked(this.restore)) {
            pane.scrollTop = 0;
        }
    });

    protected readonly groups = computed<readonly CatalogGroup[]>(() => {
        const hidden = this.hiddenGroups();
        return this.allGroups().filter((group) => !hidden.has(group.title));
    });

    private readonly allGroups = computed<readonly CatalogGroup[]>(() => {
        if (!this.isSeries()) {
            return this.catalog
                .index()
                .groupsByKind[this.kind()].map((group) => ({
                    title: group.title,
                    count: group.channels.length,
                }));
        }

        // A series belongs to the group most of its episodes sit in, so the
        // rail counts shows rather than episode rows.
        const counts = new Map<string, number>();
        for (const series of this.seriesCatalog.series()) {
            counts.set(
                series.primaryGroup,
                (counts.get(series.primaryGroup) ?? 0) + 1
            );
        }
        return [...counts].map(([title, count]) => ({ title, count }));
    });

    protected readonly categoryItems = computed(() => {
        const items = this.groups().map((group) => ({
            id: group.title,
            // Rows with no `group-title` are an ordinary group, not missing
            // data: name it as the channel list does.
            name: group.title || this.translate.instant('CHANNELS.UNGROUPED'),
            count: group.count,
        }));
        return this.favoriteIds.supported
            ? withFavoritesGroup(
                  items,
                  this.translate.instant('PORTALS.FAVORITES'),
                  this.favoriteCards().length
              )
            : items;
    });

    /** The section's cards the playlist's favorites table holds. */
    private readonly favoriteCards = computed(() =>
        m3uFavoriteCards(this.allCards(), this.favoriteIds.ids())
    );

    /**
     * Search spans the whole section, not the selected group. A viewer
     * looking for a film does not know which of forty-five groups the
     * provider filed it under, and the group rail stays visible so the
     * result is still placeable.
     */
    private readonly allCards = computed<readonly M3uCatalogCard[]>(() => {
        if (this.isSeries()) {
            // Two dubs of one show, or two remakes, are deliberately two
            // series. Without the qualifier they would be two cards with
            // the same name and poster.
            const series = this.seriesCatalog.series();
            const duplicates = duplicateM3uSeriesTitles(series);
            return series.map((entry) =>
                toM3uSeriesCard(
                    entry,
                    duplicates.has(foldSearchText(entry.title))
                )
            );
        }

        // Optional in the Settings shape, so the store's signal is too.
        const strip = this.settingsStore.stripCountryPrefix?.() === true;
        return this.catalog
            .index()
            .byKind[this.kind()].map((channel) =>
                toM3uCatalogCard(channel, strip)
            );
    });

    private readonly groupOfCard = computed<ReadonlyMap<string, string>>(() => {
        const map = new Map<string, string>();
        if (this.isSeries()) {
            for (const series of this.seriesCatalog.series()) {
                map.set(`series:${series.id}`, series.primaryGroup);
            }
            return map;
        }

        for (const group of this.catalog.index().groupsByKind[this.kind()]) {
            for (const channel of group.channels) {
                map.set(channel.id || channel.url, group.title);
            }
        }
        return map;
    });

    /**
     * The row behind each card, resolved once by the same identity the card
     * carries. Searching the kind's array by URL on activation would pick
     * the first row sharing that URL rather than the one clicked.
     */
    private readonly channelByCardId = computed<ReadonlyMap<string, Channel>>(
        () =>
            new Map(
                this.catalog
                    .index()
                    .byKind[this.kind()].map((channel) => [
                        channel.id || channel.url,
                        channel,
                    ])
            )
    );

    protected readonly matches = computed<readonly M3uCatalogCard[]>(() => {
        const term = foldSearchText(this.searchTerm().trim());
        if (term) {
            return this.allCards().filter((card) =>
                foldSearchText(card.name).includes(term)
            );
        }

        const selected = this.selectedGroup();
        if (selected === M3U_FAVORITES_GROUP_ID) {
            return this.favoriteCards();
        }
        const lookup = this.groupOfCard();
        return this.allCards().filter(
            (card) => lookup.get(card.id) === selected
        );
    });

    protected readonly cards = computed(() =>
        this.matches().slice(0, this.windowSize())
    );

    protected readonly hasMore = computed(
        () => this.windowSize() < this.matches().length
    );

    protected readonly isEmpty = computed(() => this.allCards().length === 0);

    /** Empty and finished loading; a load in flight is not an empty section. */
    protected readonly showEmptyState = computed(
        () => this.isEmpty() && !this.loading()
    );

    /** The "Favoritos" group is open and nothing in this section is favorited. */
    protected readonly showFavoritesEmpty = computed(
        () =>
            this.selectedGroup() === M3U_FAVORITES_GROUP_ID &&
            !this.searchTerm().trim() &&
            this.favoriteCards().length === 0 &&
            !this.loading()
    );

    protected readonly favoritesEmptyTitleKey = computed(() =>
        this.isSeries()
            ? 'CHANNELS.CATALOG.NO_FAVORITE_SERIES'
            : 'CHANNELS.CATALOG.NO_FAVORITE_MOVIES'
    );

    protected readonly emptyTitleKey = computed(() =>
        this.isSeries()
            ? 'CHANNELS.CATALOG.NO_SERIES'
            : 'CHANNELS.CATALOG.NO_MOVIES'
    );

    /**
     * The hint has to name what the playlist DOES hold.
     *
     * The rail only offers a section the playlist has rows for, so this is
     * reachable by a deep link or a bookmark — but "only contains live
     * channels" would be a plain lie on a playlist whose films are one
     * section away, and the viewer would have no reason to look for them.
     */
    protected readonly emptyHintKey = computed(() => {
        const counts = this.catalog.index().counts;
        const other = this.isSeries() ? counts.movie : counts.episode;
        if (other === 0) {
            return 'CHANNELS.CATALOG.EMPTY_HINT';
        }
        return this.isSeries()
            ? 'CHANNELS.CATALOG.EMPTY_HINT_MOVIES'
            : 'CHANNELS.CATALOG.EMPTY_HINT_SERIES';
    });

    constructor() {
        effect(() => {
            const handoff = this.episodeHandoff();
            const series = this.seriesCatalog.series();
            if (!handoff || this.loading() || series.length === 0) {
                return;
            }
            untracked(() => {
                this.episodeHandoff.set(null);
                const match = findM3uSeriesOfEpisode(
                    series,
                    handoff.url,
                    handoff.id
                );
                if (match) {
                    void this.router.navigate(['..', 'series', match.id], {
                        relativeTo: this.route,
                        replaceUrl: true,
                    });
                }
            });
        });

        // Applies the remembered window and scroll once its group is on screen.
        effect(() => {
            const view = this.restore();
            const selected = this.selectedGroup();
            if (
                !view ||
                this.loading() ||
                !this.favoriteIds.ready() ||
                this.allCards().length === 0
            ) {
                return;
            }
            untracked(() => {
                this.restore.set(undefined);
                const known =
                    selected === M3U_FAVORITES_GROUP_ID ||
                    this.groups().some((group) => group.title === selected);
                if (selected !== view.group || !known) {
                    return;
                }
                this.windowSize.set(view.windowSize);
                // Two frames: one to render the window, one to scroll it.
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                        const pane = this.contentPane()?.nativeElement;
                        if (pane) {
                            pane.scrollTop = view.scrollTop;
                        }
                    })
                );
            });
        });

        effect(() => {
            const playlistId = this.playlist()?._id;
            const type = this.isSeries() ? 'series' : 'movie';
            untracked(() => void this.favoriteIds.load(playlistId, type));
        });

        // Selecting a group keeps the grid populated on arrival; the portals
        // do the same rather than opening on an empty pane. "Favoritos" wins
        // only when it has items, so the ids are awaited first.
        effect(() => {
            const groups = this.groups();
            const selected = this.selectedGroup();
            if (!this.favoriteIds.ready()) {
                return;
            }
            const favorites = this.favoriteIds.supported;
            const known =
                selected === M3U_FAVORITES_GROUP_ID
                    ? favorites
                    : groups.some((group) => group.title === selected);
            if (groups.length > 0 && !known) {
                this.selectedGroup.set(
                    initialCatalogGroup(
                        groups.map((group) => group.title),
                        favorites,
                        untracked(this.favoriteCards).length
                    )
                );
            }
        });
    }

    protected onGroupSelected(item: { id?: string | number }): void {
        this.selectedGroup.set(String(item.id ?? ''));
        this.rememberView(0);
    }

    private rememberView(scrollTop: number): void {
        this.memory.remember(this.playlistRouteId, this.kind(), {
            group: this.selectedGroup(),
            search: this.searchTerm(),
            windowSize: this.windowSize(),
            scrollTop,
        });
    }

    private readEpisodeHandoff(): { url: string; id: string } | null {
        const state = this.router.currentNavigation?.()?.extras?.state;
        const url = state?.[OPEN_M3U_CHANNEL_URL_STATE_KEY];
        const id = state?.[OPEN_M3U_CHANNEL_ID_STATE_KEY];
        return typeof url === 'string' && url
            ? { url, id: typeof id === 'string' ? id : '' }
            : null;
    }

    protected onLoadMore(): void {
        this.windowSize.update((size) => size + WINDOW_STEP);
    }

    /**
     * A series card opens its detail page; a movie card hands the row to the
     * player under this same section, which decides between the movie detail
     * shell and inline playback. The view is remembered first so coming back
     * restores the group, the search and the scroll position.
     */
    protected onCardActivated(card: Record<string, unknown>): void {
        this.rememberView(
            untracked(this.contentPane)?.nativeElement.scrollTop ?? 0
        );
        const seriesId = card['seriesId'];
        if (typeof seriesId === 'number') {
            void this.router.navigate(['..', 'series', seriesId], {
                relativeTo: this.route,
            });
            return;
        }

        const cardId = card['id'];
        const channel =
            typeof cardId === 'string'
                ? this.channelByCardId().get(cardId)
                : undefined;
        if (!channel) {
            return;
        }

        // State, not a dispatch: the route session resets the active channel.
        void this.router.navigate(['play'], {
            relativeTo: this.route,
            state: {
                [OPEN_M3U_CHANNEL_URL_STATE_KEY]: channel.url,
                [OPEN_M3U_CHANNEL_ID_STATE_KEY]: channel.id,
            },
        });
    }
}
