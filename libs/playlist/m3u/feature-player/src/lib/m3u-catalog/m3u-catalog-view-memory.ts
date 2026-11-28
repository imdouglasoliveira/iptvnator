import { Injectable } from '@angular/core';

/** What a catalog section showed when the viewer left it for a detail page. */
export interface M3uCatalogView {
    readonly group: string | null;
    readonly search: string;
    readonly windowSize: number;
    readonly scrollTop: number;
}

/**
 * Remembers each playlist section's group, search and scroll position, so
 * coming back from a film or a series lands where the viewer left.
 */
@Injectable({ providedIn: 'root' })
export class M3uCatalogViewMemory {
    private readonly views = new Map<string, M3uCatalogView>();

    recall(playlistId: string, kind: string): M3uCatalogView | undefined {
        return this.views.get(`${playlistId}\u0000${kind}`);
    }

    remember(playlistId: string, kind: string, view: M3uCatalogView): void {
        if (playlistId) {
            this.views.set(`${playlistId}\u0000${kind}`, view);
        }
    }
}
