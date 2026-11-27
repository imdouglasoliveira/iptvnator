import { inject, Injectable } from '@angular/core';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import { classifyM3uEntry } from '@iptvnator/shared/m3u-utils/catalog';
import { firstValueFrom } from 'rxjs';

interface PriorityFavorites {
    itemsRevision: number;
    favoriteIds: string[];
    channels: Channel[];
    userAgent?: string | null;
    referrer?: string | null;
}

@Injectable({ providedIn: 'root' })
export class M3uPriorityOpenService {
    private readonly settings = inject(SettingsStore);
    private readonly playlists = inject(PlaylistsService);

    open(
        playlistId: string,
        isCurrent: () => boolean,
        publish: (favorites: PriorityFavorites) => void,
        nextFrame = afterPaint
    ): Promise<void> | undefined {
        const bridge = globalThis.window?.electron;
        if (
            !bridge?.dbGetM3uFavoritesSnapshot ||
            this.settings.optimizations?.()?.priorityOpen === false
        ) {
            return undefined;
        }
        return this.read(
            () =>
                firstValueFrom(
                    this.playlists.getM3uFavoriteChannels(playlistId, 'snapshot')
                ),
            isCurrent,
            publish,
            nextFrame
        );
    }

    configureHeaders(userAgent?: string | null, referrer?: string | null): void {
        void globalThis.window?.electron
            ?.setUserAgent?.(userAgent ?? undefined, referrer ?? undefined)
            .catch(() =>
                console.warn(
                    redactSensitiveData({ event: 'm3u-playlist-headers-failed' })
                )
            );
    }

    private async read(
        readText: () => Promise<string | null>,
        isCurrent: () => boolean,
        publish: (favorites: PriorityFavorites) => void,
        nextFrame: () => Promise<void>
    ): Promise<void> {
        let snapshot: PriorityFavorites;
        try {
            const text = await readText();
            if (
                text === null ||
                !isCurrent() ||
                this.settings.optimizations?.()?.priorityOpen === false
            ) {
                return;
            }
            snapshot = JSON.parse(text);
            if (!isSnapshot(snapshot)) throw new Error('Invalid favorites snapshot');
        } catch {
            console.warn(
                redactSensitiveData({ event: 'm3u-favorites-snapshot-read-failed' })
            );
            return;
        }
        const channels = snapshot.channels.filter((channel) => {
            const kind = classifyM3uEntry(channel);
            return kind === 'live' || kind === 'radio';
        });
        if (!channels.length) return;
        this.configureHeaders(snapshot.userAgent, snapshot.referrer);
        publish({ ...snapshot, channels });
        await nextFrame();
    }
}

function isSnapshot(value: PriorityFavorites | null): value is PriorityFavorites {
    return (
        !!value &&
        Number.isSafeInteger(value.itemsRevision) &&
        Array.isArray(value.favoriteIds) &&
        value.favoriteIds.every((id) => typeof id === 'string') &&
        Array.isArray(value.channels) &&
        value.channels.every((channel) => channel && typeof channel.url === 'string') &&
        (value.userAgent == null || typeof value.userAgent === 'string') &&
        (value.referrer == null || typeof value.referrer === 'string')
    );
}

function afterPaint(): Promise<void> {
    return new Promise((resolve) => {
        let secondFrame: number | undefined;
        // The second frame leaves a paint opportunity after the preview update.
        const firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => {
                clearTimeout(timeout);
                resolve();
            });
        });
        const timeout = setTimeout(() => {
            cancelAnimationFrame(firstFrame);
            if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
            resolve();
        }, 100);
    });
}
