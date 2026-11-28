import {
    favoriteReferenceKey,
    stalkerFavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
import { FAVORITES_PLAYLIST_BRIDGE } from '@iptvnator/services/favorites-events';
import { inject, Injectable } from '@angular/core';
import { StalkerCollectionMetadataService } from '@iptvnator/portal/stalker/data-access';
import { normalizeXtreamContentTypes } from '@iptvnator/shared/interfaces';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { firstValueFrom, map } from 'rxjs';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SourceActivityService,
    USER_DATA_STORAGE,
} from '@iptvnator/services';
import {
    Channel,
    extractStalkerItemId,
    extractStalkerItemPoster,
    extractStalkerItemTitle,
    extractStalkerItemType,
    isStalkerRadioItem,
    normalizeStalkerDate,
    Playlist,
    PlaylistMeta,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import {
    buildCollectionUid,
    CollectionScope,
    isStalkerItem,
    UnifiedCollectionItem,
    xtreamContentType,
    XtreamFavoriteRow,
} from '@iptvnator/portal/shared/util';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import { m3uCollectionContentType } from '@iptvnator/shared/m3u-utils/catalog';
import { M3uCatalogFavoritesActions } from './m3u-catalog-favorites.actions';
import {
    buildFavoritePositionUpdates,
    mergeM3uCatalogFavorites,
    splitFavoriteRowsByPlaylist,
} from './m3u-catalog-favorites.mapper';
import { M3uCatalogFavoritesParental } from './m3u-catalog-favorites-parental';
import {
    mapXtreamContentItem,
    mapXtreamRow,
} from './unified-favorites-xtream.mapper';

const GLOBAL_FAVORITES_ORDER_KEY = 'global-favorites-channel-order-v1';

type PlaylistWithChannels = Omit<Playlist, 'playlist'> & {
    readonly playlist?: { readonly items?: Channel[] };
};
type StalkerPortalFavoriteItem = StalkerPortalItem & {
    category_id?: string;
    raw?: string;
    [key: string]: unknown;
};

@Injectable({ providedIn: 'root' })
export class UnifiedFavoritesDataService {
    private readonly stalkerMetadata = inject(StalkerCollectionMetadataService);
    private readonly favoriteSync = inject(FAVORITES_PLAYLIST_BRIDGE);
    private readonly store = inject(Store);
    private readonly dbService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly translate = inject(TranslateService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly activity = inject(SourceActivityService);
    private readonly xtreamDataSource = inject(XTREAM_DATA_SOURCE);
    private readonly userDataStorage = inject(USER_DATA_STORAGE);
    private readonly catalogFavorites = inject(M3uCatalogFavoritesActions);
    private readonly catalogParental = inject(M3uCatalogFavoritesParental);

    async getFavorites(
        scope: CollectionScope,
        playlistId?: string,
        portalType?: string
    ): Promise<UnifiedCollectionItem[]> {
        const items =
            scope === 'playlist' && playlistId
                ? await this.getPlaylistFavorites(playlistId, portalType)
                : await this.getAllFavorites();
        return items.some((item) => item.m3uCatalogId != null)
            ? this.catalogParental.filter(items)
            : items;
    }

    async addFavorite(item: UnifiedCollectionItem): Promise<void> {
        switch (item.sourceType) {
            case 'm3u':
                await this.addM3uFavorite(item);
                break;
            case 'xtream':
                await this.writeXtreamFavorite(item, () =>
                    this.addXtreamFavorite(item)
                );
                break;
            case 'stalker':
                await this.addStalkerFavorite(item);
                break;
        }
    }

    /** A reused provider ID alone cannot determine a recent row's favorite status. */
    async isXtreamFavorite(item: UnifiedCollectionItem): Promise<boolean> {
        const contentId =
            item.contentId ?? (await this.resolveXtreamContentId(item));
        if (contentId == null) return false;
        if (await this.xtreamFavoritesBridge(item.playlistId)) {
            return this.dbService.isFavorite(contentId, item.playlistId);
        }
        return this.xtreamDataSource.isFavorite(
            {
                id: contentId,
                providerId: item.xtreamId,
                type: item.contentType,
                ...(item.xtreamIdentity
                    ? { identity: item.xtreamIdentity }
                    : {}),
            },
            item.playlistId
        );
    }

    async removeFavorite(item: UnifiedCollectionItem): Promise<void> {
        switch (item.sourceType) {
            case 'm3u': {
                if (item.m3uCatalogId != null) {
                    await this.catalogFavorites.remove([item]);
                    break;
                }
                await this.transformM3uFavorites(item.playlistId, (current) =>
                    current.filter(
                        (favoriteId) =>
                            favoriteId !== item.streamUrl &&
                            favoriteId !== item.channelId
                    )
                );
                break;
            }
            case 'xtream':
                await this.writeXtreamFavorite(item, () =>
                    this.removeXtreamFavorite(item)
                );
                break;
            case 'stalker': {
                const sourceItemId = item.stalkerId ?? item.uid.split('::')[2];
                await firstValueFrom(
                    this.playlistsService.removeFromPortalFavorites(
                        item.playlistId,
                        sourceItemId,
                        item.stalkerItem as StalkerPortalItem
                    )
                );
                break;
            }
        }
    }

    private async addM3uFavorite(item: UnifiedCollectionItem): Promise<void> {
        const favoriteId = item.streamUrl ?? item.channelId;
        if (!favoriteId) {
            return;
        }

        await this.transformM3uFavorites(item.playlistId, (current) =>
            current.includes(favoriteId) ? current : [...current, favoriteId]
        );
    }

    private isSqliteLive(item: UnifiedCollectionItem): boolean {
        return (
            item.contentType === 'live' &&
            this.runtime.supportsXtreamSqliteDataSource
        );
    }

    private writeXtreamFavorite(
        item: UnifiedCollectionItem,
        write: () => Promise<void>
    ): Promise<void> {
        return this.isSqliteLive(item)
            ? this.activity.runWhenIdle(item.playlistId, write)
            : write();
    }

    private async removeXtreamFavorite(
        item: UnifiedCollectionItem
    ): Promise<void> {
        const electron = await this.xtreamFavoritesBridge(item.playlistId);
        if (electron) {
            const target =
                item.favoriteId != null
                    ? { favoriteId: item.favoriteId }
                    : await this.xtreamFavoriteContentId(item);
            if (target != null)
                await electron.dbRemoveFavorite(target, item.playlistId);
            return;
        }
        if (item.contentId == null && item.xtreamId == null) return;
        await this.xtreamDataSource.removeFavorite(
            {
                id: item.contentId ?? item.xtreamId!,
                providerId: item.xtreamId,
                type: item.contentType,
                ...(item.xtreamIdentity
                    ? { identity: item.xtreamIdentity }
                    : {}),
            },
            item.playlistId
        );
    }

    private async xtreamFavoriteContentId(item: UnifiedCollectionItem) {
        // Collection rows can still contain their pre-refresh SQLite ID.
        if (this.isSqliteLive(item) && item.xtreamId != null)
            return this.resolveXtreamContentId(item);
        return item.contentId ?? this.resolveXtreamContentId(item);
    }

    private async addXtreamFavorite(
        item: UnifiedCollectionItem
    ): Promise<void> {
        const contentId = await this.xtreamFavoriteContentId(item);
        if (contentId == null) {
            throw new Error('Favorite could not be saved');
        }

        const electron = await this.xtreamFavoritesBridge(item.playlistId);
        if (!electron) {
            await this.xtreamDataSource.addFavorite(
                {
                    id: contentId,
                    providerId: item.xtreamId,
                    type: item.contentType,
                    ...(item.xtreamIdentity
                        ? { identity: item.xtreamIdentity }
                        : {}),
                },
                item.playlistId,
                item.posterUrl ?? item.logo ?? undefined
            );
            return;
        }

        const result = await electron.dbAddFavorite(
            contentId,
            item.playlistId,
            item.posterUrl ?? item.logo ?? undefined
        );
        if (!result.success) {
            throw new Error(result.error ?? 'Favorite could not be saved');
        }
    }

    private async addStalkerFavorite(
        item: UnifiedCollectionItem
    ): Promise<void> {
        const stalkerItem: StalkerPortalItem =
            (item.stalkerItem as StalkerPortalItem | undefined) ?? {};
        const favorite: StalkerPortalFavoriteItem = {
            ...stalkerItem,
            favoriteContentType:
                item.contentType === 'series' &&
                !stalkerItem.is_series &&
                !stalkerItem.series?.length
                    ? 'series'
                    : item.contentType === 'movie'
                      ? 'vod'
                      : item.radio === 'true'
                        ? 'radio'
                        : 'itv',
            id:
                item.stalkerId ??
                extractStalkerItemId(stalkerItem) ??
                item.uid.split('::')[2],
            cmd: item.stalkerCmd ?? stalkerItem.cmd,
            title: item.name,
            name: stalkerItem.name ?? item.name,
            o_name: stalkerItem.o_name ?? item.name,
            category_id: String(
                item.categoryId ??
                    stalkerItem.category_id ??
                    (item.radio === 'true' || isStalkerRadioItem(stalkerItem)
                        ? 'radio'
                        : 'itv')
            ),
            cover:
                stalkerItem.cover ?? item.logo ?? item.posterUrl ?? undefined,
            logo: stalkerItem.logo ?? item.logo ?? item.posterUrl ?? undefined,
            radio:
                item.radio === 'true' || isStalkerRadioItem(stalkerItem)
                    ? true
                    : undefined,
            added_at: new Date().toISOString(),
        };

        await firstValueFrom(
            this.playlistsService.addPortalFavorite(item.playlistId, favorite)
        );
    }

    async clearFavorites(items: UnifiedCollectionItem[]): Promise<void> {
        if (items.length === 0) {
            return;
        }

        await Promise.all([
            this.clearM3uFavorites(
                items.filter((item) => item.sourceType === 'm3u')
            ),
            this.clearXtreamFavorites(
                items.filter((item) => item.sourceType === 'xtream')
            ),
            this.clearStalkerFavorites(
                items.filter((item) => item.sourceType === 'stalker')
            ),
        ]);
    }

    async reorder(
        items: UnifiedCollectionItem[],
        options?: {
            scope: CollectionScope;
            playlistId?: string;
            portalType?: string;
        }
    ): Promise<void> {
        if (
            options?.scope === 'playlist' &&
            options.playlistId &&
            options.portalType === 'm3u'
        ) {
            const orderedIds = items
                .map((item) => item.streamUrl ?? item.channelId ?? '')
                .filter((value) => value.length > 0);
            const orderedIdSet = new Set(orderedIds);
            await this.transformM3uFavorites(options.playlistId, (current) => [
                ...orderedIds,
                ...current.filter((favorite) => !orderedIdSet.has(favorite)),
            ]);
            if (items.some((item) => item.m3uCatalogId != null)) {
                await this.catalogFavorites.savePositions(items);
            }
            return;
        }

        if (
            options?.scope === 'playlist' &&
            options.playlistId &&
            options.portalType === 'stalker'
        ) {
            await firstValueFrom(
                this.playlistsService.transformPlaylistFavorites(
                    options.playlistId,
                    (current) => {
                        const currentFavorites = current.filter(isStalkerItem);
                        const favoritesById = new Map(
                            currentFavorites.map((favorite) => [
                                this.getStalkerFavoriteId(favorite),
                                favorite,
                            ])
                        );
                        const reorderedFavorites = items
                            .map(
                                (item) =>
                                    favoritesById.get(
                                        this.getStalkerFavoriteId(item)
                                    ) ?? null
                            )
                            .filter(
                                (favorite): favorite is StalkerPortalItem =>
                                    favorite !== null
                            );
                        const reorderedIds = new Set(
                            reorderedFavorites.map((favorite) =>
                                this.getStalkerFavoriteId(favorite)
                            )
                        );
                        return [
                            ...reorderedFavorites,
                            ...currentFavorites.filter(
                                (favorite) =>
                                    !reorderedIds.has(
                                        this.getStalkerFavoriteId(favorite)
                                    )
                            ),
                            ...current.filter(
                                (favorite) => !isStalkerItem(favorite)
                            ),
                        ];
                    }
                )
            );
            return;
        }

        const updates = buildFavoritePositionUpdates(items);
        const nativeSources = new Set<string>();
        let electron: Window['electron'] | undefined;
        for (const id of new Set(updates.map((update) => update.playlist_id))) {
            const bridge = await this.xtreamFavoritesBridge(id);
            if (bridge) {
                nativeSources.add(id);
                electron = bridge;
            }
        }
        const xtreamUpdates = updates.filter((update) =>
            nativeSources.has(update.playlist_id)
        );

        if (
            options?.scope === 'playlist' &&
            options.playlistId &&
            options.portalType === 'xtream'
        ) {
            if (xtreamUpdates.length > 0 && electron) {
                await electron.dbReorderGlobalFavorites(xtreamUpdates);
            } else {
                const reordered = items.map((item) => item.uid);
                const subset = new Set(reordered);
                let index = 0;
                const merged = (await this.getSavedOrder()).map((uid) =>
                    subset.has(uid) ? reordered[index++] : uid
                );
                await this.saveOrder([...merged, ...reordered.slice(index)]);
            }
            return;
        }

        await Promise.all([
            xtreamUpdates.length > 0 && electron
                ? electron.dbReorderGlobalFavorites(xtreamUpdates)
                : Promise.resolve(),
            this.saveOrder(items.map((item) => item.uid)),
        ]);
    }

    private async getAllFavorites(): Promise<UnifiedCollectionItem[]> {
        const rows = await this.readGlobalRows();
        const [m3u, xtream, stalker, order] = await Promise.all([
            this.getM3uFavorites(rows),
            this.getXtreamAllFavorites(rows),
            this.getStalkerAllFavorites(),
            this.getSavedOrder(),
        ]);
        return this.applyOrder([...m3u, ...xtream, ...stalker], order);
    }

    private async clearM3uFavorites(
        items: UnifiedCollectionItem[]
    ): Promise<void> {
        const catalog = items.filter((item) => item.m3uCatalogId != null);
        if (catalog.length > 0) await this.catalogFavorites.remove(catalog);
        const groupedItems = this.groupItemsByPlaylist(
            items.filter((item) => item.m3uCatalogId == null)
        );

        await Promise.all(
            Array.from(groupedItems.entries()).map(
                async ([playlistId, playlistItems]) => {
                    const targetIds = new Set<string>();
                    playlistItems.forEach((item) => {
                        [item.streamUrl, item.channelId].forEach((value) => {
                            const normalized = value?.trim();
                            if (normalized) {
                                targetIds.add(normalized);
                            }
                        });
                    });

                    await this.transformM3uFavorites(playlistId, (current) =>
                        current.filter(
                            (favorite) => !targetIds.has(favorite.trim())
                        )
                    );
                }
            )
        );
    }

    private async clearXtreamFavorites(
        items: UnifiedCollectionItem[]
    ): Promise<void> {
        await Promise.all(items.map((item) => this.removeFavorite(item)));
    }

    private async clearStalkerFavorites(
        items: UnifiedCollectionItem[]
    ): Promise<void> {
        const groupedItems = this.groupItemsByPlaylist(items);

        await Promise.all(
            Array.from(groupedItems.entries()).map(
                async ([playlistId, playlistItems]) => {
                    const targetIds = new Set(
                        playlistItems.map((item) =>
                            this.getStalkerFavoriteId(item)
                        )
                    );

                    await firstValueFrom(
                        this.playlistsService.transformPlaylistFavorites(
                            playlistId,
                            (current) =>
                                current.filter(
                                    (favorite) =>
                                        !isStalkerItem(favorite) ||
                                        !targetIds.has(
                                            this.getStalkerFavoriteId(favorite)
                                        )
                                )
                        )
                    );
                }
            )
        );
    }

    private async getPlaylistFavorites(
        playlistId: string,
        portalType?: string
    ): Promise<UnifiedCollectionItem[]> {
        if (portalType === 'xtream')
            return this.getXtreamPlaylistFavorites(playlistId);
        if (portalType === 'stalker')
            return this.getStalkerPlaylistFavorites(playlistId);
        return this.getM3uPlaylistFavorites(playlistId);
    }

    private async getM3uFavorites(
        rows: XtreamFavoriteRow[] | null
    ): Promise<UnifiedCollectionItem[]> {
        const allMeta = await this.getAllMeta();
        const results: UnifiedCollectionItem[] = [];
        for (const meta of allMeta.filter(
            (p) => p._id && !p.serverUrl && !p.macAddress
        )) {
            results.push(...(await this.extractM3uFavorites(meta)));
        }
        return mergeM3uCatalogFavorites(results, rows ?? []);
    }

    private async getM3uPlaylistFavorites(
        id: string
    ): Promise<UnifiedCollectionItem[]> {
        const meta = await this.getPlaylistMeta(id);
        const json = meta ? await this.extractM3uFavorites(meta) : [];
        if (!this.electronActivityBridge) return json;
        try {
            const rows = (await this.dbService.getFavorites(
                id
            )) as unknown as XtreamFavoriteRow[];
            return mergeM3uCatalogFavorites(json, rows);
        } catch {
            return json;
        }
    }

    private async extractM3uFavorites(
        meta: PlaylistMeta
    ): Promise<UnifiedCollectionItem[]> {
        if (!meta.favorites?.length) return [];

        let playlist: PlaylistWithChannels | undefined;
        try {
            playlist = (await firstValueFrom(
                this.playlistsService.getPlaylistById(meta._id)
            )) as PlaylistWithChannels | undefined;
        } catch {
            return [];
        }
        if (playlist) playlist = await this.favoriteSync.project(playlist);
        const favoriteIds = ((playlist?.favorites ?? []) as string[]).map(
            String
        );
        const channels = playlist?.playlist?.items ?? [];
        const channelsByFavoriteId = new Map<string, Channel>();
        channels.forEach((channel) => {
            if (channel.url?.trim()) {
                channelsByFavoriteId.set(channel.url.trim(), channel);
            }
            if (channel.id?.trim()) {
                channelsByFavoriteId.set(channel.id.trim(), channel);
            }
        });

        const seenUrls = new Set<string>();
        return favoriteIds
            .map((favoriteId, index) => {
                const channel = channelsByFavoriteId.get(favoriteId.trim());
                if (!channel?.url || seenUrls.has(channel.url)) {
                    return null;
                }
                seenUrls.add(channel.url);
                const sourceItemId = channel.url?.trim() || channel.id?.trim();
                if (!sourceItemId) {
                    return null;
                }

                const contentType = m3uCollectionContentType(channel);
                const artwork = channel.tvg?.logo ?? null;

                return {
                    uid: buildCollectionUid('m3u', meta._id, sourceItemId),
                    name: channel.name,
                    contentType,
                    sourceType: 'm3u' as const,
                    playlistId: meta._id,
                    playlistName: meta.title || meta.filename || 'M3U',
                    logo: artwork,
                    // The live tab reads `logo`, the movie and series tabs
                    // read `posterUrl`. An M3U row has one artwork field,
                    // so now that these rows can be typed as films or
                    // episodes it has to reach both — otherwise a
                    // favourited film renders as missing artwork.
                    posterUrl: contentType === 'live' ? null : artwork,
                    streamUrl: channel.url,
                    channelId: channel.id,
                    radio: channel.radio,
                    m3uChannel: channel,
                    tvgId: channel.tvg?.id || channel.tvg?.name || channel.name,
                    addedAt: new Date(0).toISOString(),
                    position: index,
                } satisfies UnifiedCollectionItem;
            })
            .filter((channel) => channel !== null) as UnifiedCollectionItem[];
    }

    private async readGlobalRows(): Promise<XtreamFavoriteRow[] | null> {
        if (!this.electronActivityBridge) return null;
        try {
            return (await this.dbService.getAllGlobalFavorites()) as XtreamFavoriteRow[];
        } catch {
            return [];
        }
    }

    private async getXtreamAllFavorites(
        globalRows: XtreamFavoriteRow[] | null
    ): Promise<UnifiedCollectionItem[]> {
        if (!globalRows) {
            const allMeta = await this.getAllMeta();
            const results: UnifiedCollectionItem[] = [];
            for (const meta of allMeta.filter(
                (p) => p._id && this.isXtreamPlaylist(p)
            )) {
                results.push(
                    ...(await this.getXtreamPlaylistFavorites(meta._id))
                );
            }
            return results;
        }

        try {
            const rows = splitFavoriteRowsByPlaylist(globalRows).xtream;
            const metas = new Map(
                (await this.getAllMeta()).map((meta) => [meta._id, meta])
            );
            return rows.map((r) => ({
                ...mapXtreamRow(r),
                catalogDisabled: !normalizeXtreamContentTypes(
                    metas.get(r.playlist_id)?.xtreamContentTypes
                ).includes(xtreamContentType(r.type)),
            }));
        } catch {
            return [];
        }
    }

    private async getXtreamPlaylistFavorites(
        playlistId: string
    ): Promise<UnifiedCollectionItem[]> {
        try {
            const meta = await this.getPlaylistMeta(playlistId);
            if (!(await this.xtreamFavoritesBridge(playlistId))) {
                const rows =
                    await this.xtreamDataSource.getFavorites(playlistId);
                return this.applyOrder(
                    rows.map((row) => ({
                        ...mapXtreamContentItem(row, playlistId, meta?.title),
                        catalogDisabled:
                            this.runtime.supportsXtreamSqliteDataSource &&
                            !normalizeXtreamContentTypes(
                                meta?.xtreamContentTypes
                            ).includes(xtreamContentType(row.type)),
                    })),
                    await this.getSavedOrder()
                );
            }

            const rows = await this.dbService.getFavorites(playlistId);
            return (rows as unknown as XtreamFavoriteRow[]).map((r) => ({
                ...mapXtreamRow(r),
                playlistId,
                playlistName: meta?.title || 'Xtream',
                catalogDisabled: !normalizeXtreamContentTypes(
                    meta?.xtreamContentTypes
                ).includes(xtreamContentType(r.type)),
            }));
        } catch {
            return [];
        }
    }

    private async resolveXtreamContentId(
        item: UnifiedCollectionItem
    ): Promise<number | null> {
        if (item.xtreamId == null) {
            return null;
        }

        const args: Parameters<DatabaseService['getContentByXtreamId']> = [
            item.xtreamId,
            item.playlistId,
            item.contentType,
        ];
        if (this.isSqliteLive(item) && typeof item.categoryId === 'number') {
            args[4] = item.categoryId;
            args[6] = true;
        }
        if (!(await this.xtreamFavoritesBridge(item.playlistId))) {
            const content = await this.xtreamDataSource.getContentByXtreamId(
                ...args
            );
            if (content) return content.id;
            if (
                args[6] &&
                !(await this.xtreamDataSource.supportsPortableFavorites?.(
                    item.playlistId
                ))
            )
                return null;
            return item.xtreamId;
        }

        if (
            item.xtreamIdentity?.tmdbId != null ||
            item.xtreamIdentity?.releaseYear != null
        )
            args[3] = item.xtreamIdentity;
        const content = await this.dbService.getContentByXtreamId(...args);
        return content?.id ?? null;
    }

    private async getStalkerAllFavorites(): Promise<UnifiedCollectionItem[]> {
        const allMeta = await this.getAllMeta();
        const results: UnifiedCollectionItem[] = [];
        for (const meta of allMeta.filter((p) => p._id && p.macAddress)) {
            results.push(...(await this.extractStalkerFavorites(meta)));
        }
        return results;
    }

    private async getStalkerPlaylistFavorites(
        id: string
    ): Promise<UnifiedCollectionItem[]> {
        const meta = await this.getPlaylistMeta(id);
        return meta ? this.extractStalkerFavorites(meta) : [];
    }

    private async extractStalkerFavorites(
        meta: PlaylistMeta
    ): Promise<UnifiedCollectionItem[]> {
        if (!meta.favorites?.length) return [];
        let playlist: Playlist | undefined;
        try {
            await this.playlistsService.preparePortalFavoriteActions();
            playlist = (await firstValueFrom(
                this.playlistsService.getPlaylistById(meta._id)
            )) as Playlist | undefined;
        } catch {
            return [];
        }
        if (playlist) playlist = await this.favoriteSync.project(playlist);
        if (playlist) playlist = this.stalkerMetadata.project(playlist);
        const favs = Array.isArray(playlist?.favorites)
            ? playlist.favorites.filter(isStalkerItem)
            : [];

        return favs.map((fav, index) => {
            const ct = extractStalkerItemType(fav);
            const isRadio = isStalkerRadioItem(fav);
            const stalkerId = extractStalkerItemId(fav, meta._id, index);
            const poster = extractStalkerItemPoster(fav) || null;
            return {
                uid: buildCollectionUid(
                    'stalker',
                    meta._id,
                    this.getStalkerFavoriteId(fav) || stalkerId
                ),
                name:
                    extractStalkerItemTitle(fav) ||
                    this.translate.instant(
                        'WORKSPACE.GLOBAL_FAVORITES.UNKNOWN_CHANNEL'
                    ),
                contentType: ct,
                sourceType: 'stalker' as const,
                playlistId: meta._id,
                playlistName:
                    meta.title ||
                    meta.filename ||
                    this.translate.instant(
                        'WORKSPACE.DASHBOARD.STALKER_PORTAL'
                    ),
                logo: ct === 'live' ? poster : null,
                posterUrl: ct !== 'live' ? poster : null,
                tvgId: ct === 'live' ? stalkerId : undefined,
                radio: isRadio ? 'true' : undefined,
                stalkerId,
                stalkerCmd: fav.cmd,
                stalkerPortalUrl: playlist?.portalUrl ?? playlist?.url,
                stalkerMacAddress: playlist?.macAddress,
                categoryId: fav.category_id,
                stalkerItem: fav,
                addedAt:
                    normalizeStalkerDate(fav.added_at) ||
                    new Date(0).toISOString(),
                position: index,
            };
        });
    }

    private async getAllMeta(): Promise<PlaylistMeta[]> {
        return firstValueFrom(
            this.store
                .select(selectAllPlaylistsMeta)
                .pipe(map((m) => m as PlaylistMeta[]))
        );
    }

    private async getPlaylistMeta(
        id: string
    ): Promise<PlaylistMeta | undefined> {
        return (await this.getAllMeta()).find((p) => p._id === id);
    }

    private async getSavedOrder(): Promise<string[]> {
        const electron = window.electron;
        try {
            const raw =
                this.runtime.supportsAppStateStorage && electron
                    ? await electron.dbGetAppState(GLOBAL_FAVORITES_ORDER_KEY)
                    : this.userDataStorage.getItem(GLOBAL_FAVORITES_ORDER_KEY);
            return raw ? (JSON.parse(raw) as string[]) : [];
        } catch {
            return [];
        }
    }

    private async saveOrder(uidOrder: string[]): Promise<void> {
        const electron = window.electron;
        try {
            if (this.runtime.supportsAppStateStorage && electron)
                await electron.dbSetAppState(
                    GLOBAL_FAVORITES_ORDER_KEY,
                    JSON.stringify(uidOrder)
                );
            else
                this.userDataStorage.setItem(
                    GLOBAL_FAVORITES_ORDER_KEY,
                    JSON.stringify(uidOrder)
                );
        } catch {
            /* ignore */
        }
    }

    private async transformM3uFavorites(
        playlistId: string,
        transform: (currentFavorites: string[]) => string[]
    ): Promise<void> {
        const updatedPlaylist = await firstValueFrom(
            this.playlistsService.transformPlaylistFavorites(
                playlistId,
                (current) =>
                    transform(
                        current.filter(
                            (favorite): favorite is string =>
                                typeof favorite === 'string'
                        )
                    )
            )
        );
        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({
                persist: false,
                playlist: {
                    _id: playlistId,
                    favorites: updatedPlaylist.favorites,
                } as PlaylistMeta,
            })
        );
    }

    private applyOrder(
        items: UnifiedCollectionItem[],
        savedOrder: string[]
    ): UnifiedCollectionItem[] {
        if (!savedOrder.length) {
            return items.slice().sort((a, b) => {
                const pa = a.position ?? 0;
                const pb = b.position ?? 0;
                if (pa !== pb) return pa - pb;
                return (
                    new Date(b.addedAt ?? 0).getTime() -
                    new Date(a.addedAt ?? 0).getTime()
                );
            });
        }
        const orderMap = new Map(savedOrder.map((uid, i) => [uid, i]));
        const historicalUid = (item: UnifiedCollectionItem) =>
            item.sourceType === 'stalker' && item.stalkerId
                ? buildCollectionUid('stalker', item.playlistId, item.stalkerId)
                : undefined;
        const historicalCounts = new Map<string, number>();
        for (const item of items) {
            const uid = historicalUid(item);
            if (uid)
                historicalCounts.set(uid, (historicalCounts.get(uid) ?? 0) + 1);
        }
        const ordered: UnifiedCollectionItem[] = [];
        const unordered: UnifiedCollectionItem[] = [];
        for (const item of items) {
            const historical = historicalUid(item);
            const pos =
                orderMap.get(item.uid) ??
                (historical && historicalCounts.get(historical) === 1
                    ? orderMap.get(historical)
                    : undefined);
            if (pos != null) {
                ordered.push({ ...item, position: pos });
            } else {
                unordered.push(item);
            }
        }
        ordered.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        unordered.sort(
            (a, b) =>
                new Date(b.addedAt ?? 0).getTime() -
                new Date(a.addedAt ?? 0).getTime()
        );
        return [...ordered, ...unordered];
    }

    private groupItemsByPlaylist(
        items: UnifiedCollectionItem[]
    ): Map<string, UnifiedCollectionItem[]> {
        return items.reduce((groups, item) => {
            const group = groups.get(item.playlistId);
            if (group) {
                group.push(item);
            } else {
                groups.set(item.playlistId, [item]);
            }

            return groups;
        }, new Map<string, UnifiedCollectionItem[]>());
    }

    private isXtreamPlaylist(
        playlist: Pick<PlaylistMeta, 'serverUrl' | 'macAddress'>
    ): boolean {
        return Boolean(playlist.serverUrl) && !playlist.macAddress;
    }

    private getStalkerFavoriteId(
        favorite:
            | Pick<UnifiedCollectionItem, 'stalkerId' | 'uid' | 'stalkerItem'>
            | StalkerPortalItem
    ): string {
        const item = ('uid' in favorite ? favorite.stalkerItem : favorite) as
            StalkerPortalItem | undefined;
        const reference =
            item &&
            this.favoriteSync.active() &&
            stalkerFavoriteReference(item);
        if (reference) return favoriteReferenceKey(reference);
        if ('uid' in favorite) {
            return String(
                favorite.stalkerId ?? favorite.uid.split('::')[2] ?? ''
            ).trim();
        }

        return extractStalkerItemId(favorite);
    }

    private get electronActivityBridge(): Window['electron'] | undefined {
        return !this.favoriteSync.active() &&
            this.runtime.supportsPortalActivityStorage
            ? window.electron
            : undefined;
    }

    private async xtreamFavoritesBridge(
        playlistId: string
    ): Promise<Window['electron'] | undefined> {
        return this.runtime.supportsPortalActivityStorage &&
            !(await this.xtreamDataSource.supportsPortableFavorites?.(
                playlistId
            ))
            ? window.electron
            : undefined;
    }
}
