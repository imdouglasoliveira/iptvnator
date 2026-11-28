import { Injectable, Injector, inject, signal } from '@angular/core';
import { DatabaseService, RuntimeCapabilitiesService } from '@iptvnator/services';
import type { M3uCatalogFavoriteType } from '@iptvnator/shared/interfaces';

/**
 * The stable ids the playlist's favorites table holds for one catalog type,
 * which the "Favoritos" group filters the grid by. Without the bridge (PWA)
 * the group does not exist and the ids stay empty.
 */
@Injectable()
export class M3uCatalogFavoriteIdsService {
    private readonly injector = inject(Injector);
    private readonly capabilities = inject(RuntimeCapabilitiesService);
    private requests = 0;

    readonly ids = signal<ReadonlySet<number>>(new Set());
    /** False until the ids of the current playlist and type have arrived. */
    readonly ready = signal(false);

    get supported(): boolean {
        return this.capabilities.supportsM3uCatalogFavorites;
    }

    async load(
        playlistId: string | undefined,
        type: M3uCatalogFavoriteType
    ): Promise<void> {
        const request = ++this.requests;
        this.ready.set(false);
        this.ids.set(new Set());
        if (!playlistId || !this.supported) {
            this.ready.set(true);
            return;
        }
        const ids = await this.injector.get(DatabaseService).getM3uCatalogFavoriteIds({
            playlistId,
            type,
        });
        if (request === this.requests) {
            this.ids.set(new Set(ids));
            this.ready.set(true);
        }
    }
}
