import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { DatabaseService } from '@iptvnator/services';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    isM3uSeriesFavoriteKey,
    m3uMovieStableId,
    m3uSeriesFavoriteKey,
} from '@iptvnator/shared/m3u-utils/catalog';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { buildFavoritePositionUpdates } from './m3u-catalog-favorites.mapper';

/** Removal and ordering of the M3U series and movies kept in the favorites table. */
@Injectable({ providedIn: 'root' })
export class M3uCatalogFavoritesActions {
    private readonly db = inject(DatabaseService);
    private readonly store = inject(Store);

    isCatalogItem(item: UnifiedCollectionItem): boolean {
        return item.sourceType === 'm3u' && item.m3uCatalogId != null;
    }

    /** Deletes the row and the matching entry of the playlist JSON, one write per item. */
    async remove(items: readonly UnifiedCollectionItem[]): Promise<void> {
        for (const item of items.filter((entry) => this.isCatalogItem(entry))) {
            await this.db.setM3uCatalogFavorite({
                playlistId: item.playlistId,
                type: item.contentType === 'series' ? 'series' : 'movie',
                stableId: item.m3uCatalogId as number,
                title: item.name,
                favorite: false,
            });
            await this.dropFromStoredMeta(item);
        }
    }

    async savePositions(
        items: readonly UnifiedCollectionItem[]
    ): Promise<void> {
        const updates = buildFavoritePositionUpdates(
            items.filter((item) => item.sourceType === 'm3u')
        );
        if (updates.length > 0) {
            await window.electron?.dbReorderGlobalFavorites(updates);
        }
    }

    private async dropFromStoredMeta(item: UnifiedCollectionItem) {
        const metas = (await firstValueFrom(
            this.store.select(selectAllPlaylistsMeta)
        )) as PlaylistMeta[];
        const current = metas.find((meta) => meta._id === item.playlistId);
        if (!current?.favorites?.length) return;
        const series = item.contentType === 'series';
        const key = m3uSeriesFavoriteKey(item.m3uCatalogId as number);
        const favorites = current.favorites.filter((entry) => {
            if (typeof entry !== 'string') return true;
            if (series) return entry !== key;
            return (
                isM3uSeriesFavoriteKey(entry) ||
                m3uMovieStableId(entry) !== item.m3uCatalogId
            );
        });
        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({
                persist: false,
                playlist: { _id: item.playlistId, favorites } as PlaylistMeta,
            })
        );
    }
}
