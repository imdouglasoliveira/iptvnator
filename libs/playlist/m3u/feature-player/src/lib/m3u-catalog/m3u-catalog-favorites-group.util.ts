import { m3uMovieStableId } from '@iptvnator/shared/m3u-utils/catalog';
import { M3uCatalogCard } from './m3u-catalog-card.util';

/** Reserved id of the "Favoritos" group; a provider group title never uses it. */
export const M3U_FAVORITES_GROUP_ID = '__favorites__';

export interface M3uCatalogCategoryItem {
    readonly id: string;
    readonly name: string;
    readonly count: number;
}

/** The id the favorites table keys this card by: the series id, or the movie's stable id. */
export function m3uCardFavoriteId(card: M3uCatalogCard): number | null {
    if (typeof card.seriesId === 'number') {
        return card.seriesId;
    }
    return card.channelUrl ? m3uMovieStableId(card.channelUrl) : null;
}

export function m3uFavoriteCards(
    cards: readonly M3uCatalogCard[],
    favoriteIds: ReadonlySet<number>
): M3uCatalogCard[] {
    if (favoriteIds.size === 0) {
        return [];
    }
    return cards.filter((card) => {
        const id = m3uCardFavoriteId(card);
        return id !== null && favoriteIds.has(id);
    });
}

/** The favorites group goes first, in the format of a provider group. */
export function withFavoritesGroup(
    items: readonly M3uCatalogCategoryItem[],
    name: string,
    count: number
): M3uCatalogCategoryItem[] {
    return [{ id: M3U_FAVORITES_GROUP_ID, name, count }, ...items];
}

/** On arrival "Favoritos" is selected only when it has items. */
export function initialCatalogGroup(
    providerGroups: readonly string[],
    favoritesEnabled: boolean,
    favoritesCount: number
): string | null {
    if (favoritesEnabled && favoritesCount > 0) {
        return M3U_FAVORITES_GROUP_ID;
    }
    return providerGroups.length > 0 ? providerGroups[0] : null;
}
