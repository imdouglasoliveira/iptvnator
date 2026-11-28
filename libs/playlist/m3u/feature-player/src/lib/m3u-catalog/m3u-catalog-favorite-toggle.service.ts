import { Injectable, Injector, inject, signal } from '@angular/core';
import {
    DatabaseService,
    NotificationService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import type {
    M3uCatalogFavoriteInput,
    M3uCatalogFavoriteType,
} from '@iptvnator/shared/interfaces';

/**
 * The heart of one series or movie detail page: reads whether the entry is a
 * favorite and flips it through the favorites table. A failed write puts the
 * icon back and says so.
 */
@Injectable()
export class M3uCatalogFavoriteToggleService {
    private readonly injector = inject(Injector);
    private readonly capabilities = inject(RuntimeCapabilitiesService);
    private loads = 0;
    private writing = false;

    readonly active = signal(false);

    /** Resolved on use: a runtime without the bridge never builds them. */
    private get database(): DatabaseService {
        return this.injector.get(DatabaseService);
    }

    get supported(): boolean {
        return this.capabilities.supportsM3uCatalogFavorites;
    }

    async load(
        playlistId: string,
        type: M3uCatalogFavoriteType,
        stableId: number
    ): Promise<void> {
        const load = ++this.loads;
        this.active.set(false);
        if (!playlistId || !this.supported) {
            return;
        }
        const ids = await this.database.getM3uCatalogFavoriteIds({
            playlistId,
            type,
        });
        if (load === this.loads && !this.writing) {
            this.active.set(ids.includes(stableId));
        }
    }

    async toggle(request: M3uCatalogFavoriteInput): Promise<void> {
        if (this.writing || !request.playlistId) {
            return;
        }
        const previous = this.active();
        this.writing = true;
        this.active.set(!previous);
        try {
            await this.database.setM3uCatalogFavorite({
                ...request,
                favorite: !previous,
            });
        } catch {
            this.active.set(previous);
            this.injector.get(NotificationService).error('PORTALS.FAVORITE_SAVE_FAILED');
        } finally {
            this.writing = false;
        }
    }
}
