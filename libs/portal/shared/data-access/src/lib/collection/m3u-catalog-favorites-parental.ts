import { inject, Injectable, Injector } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import {
    buildM3uCatalogIndex,
    m3uMovieStableId,
} from '@iptvnator/shared/m3u-utils/catalog';
import { buildM3uSeriesCatalog } from '@iptvnator/shared/m3u-utils/series';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';

interface WithheldCatalogIds {
    readonly movies: ReadonlySet<number>;
    readonly series: ReadonlySet<number>;
}

const EVERYTHING = Symbol('everything');

/** Hides table-saved M3U series and movies whose group the parental lock holds back. */
@Injectable({ providedIn: 'root' })
export class M3uCatalogFavoritesParental {
    private readonly injector = inject(Injector);
    private readonly playlists = inject(PlaylistsService);

    async filter(
        items: UnifiedCollectionItem[]
    ): Promise<UnifiedCollectionItem[]> {
        const catalog = items.filter(isCatalogItem);
        if (catalog.length === 0) return items;
        const lock = this.injector.get(ParentalLockService);
        if (!lock.active()) return items;

        const hidden = new Set<UnifiedCollectionItem>();
        for (const [playlistId, rows] of groupByPlaylist(catalog)) {
            const withheld = await this.withheldIds(
                playlistId,
                lock.withholdsEverything()
                    ? EVERYTHING
                    : new Set(lock.lockedGroupTitles(playlistId)),
                rows
            );
            for (const item of rows) {
                if (
                    withheld === EVERYTHING ||
                    (item.contentType === 'series'
                        ? withheld.series
                        : withheld.movies
                    ).has(item.m3uCatalogId as number)
                ) {
                    hidden.add(item);
                }
            }
        }
        return items.filter((item) => !hidden.has(item));
    }

    private async withheldIds(
        playlistId: string,
        locked: ReadonlySet<string> | typeof EVERYTHING,
        rows: readonly UnifiedCollectionItem[]
    ): Promise<WithheldCatalogIds | typeof EVERYTHING> {
        if (locked === EVERYTHING) return EVERYTHING;
        if (locked.size === 0) return { movies: new Set(), series: new Set() };
        const channels = await this.channelsOf(playlistId);
        if (!channels) return EVERYTHING;

        const movies = new Set<number>();
        for (const channel of channels) {
            if (channel.url && locked.has(channel.group?.title ?? '')) {
                movies.add(m3uMovieStableId(channel.url));
            }
        }
        const series = new Set<number>();
        if (rows.some((item) => item.contentType === 'series')) {
            const episodes = buildM3uCatalogIndex(channels).byKind.episode;
            for (const entry of buildM3uSeriesCatalog(episodes, playlistId)) {
                if (locked.has(entry.primaryGroup)) series.add(entry.id);
            }
        }
        return { movies, series };
    }

    private async channelsOf(playlistId: string): Promise<Channel[] | null> {
        try {
            const playlist = (await firstValueFrom(
                this.playlists.getPlaylistById(playlistId)
            )) as { playlist?: { items?: Channel[] } } | undefined;
            return playlist?.playlist?.items ?? null;
        } catch {
            return null;
        }
    }
}

function isCatalogItem(item: UnifiedCollectionItem): boolean {
    return item.sourceType === 'm3u' && item.m3uCatalogId != null;
}

function groupByPlaylist(items: readonly UnifiedCollectionItem[]) {
    const groups = new Map<string, UnifiedCollectionItem[]>();
    for (const item of items) {
        const group = groups.get(item.playlistId);
        if (group) group.push(item);
        else groups.set(item.playlistId, [item]);
    }
    return groups;
}
