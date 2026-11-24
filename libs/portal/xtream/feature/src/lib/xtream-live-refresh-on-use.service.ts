import { inject, Injectable, Injector } from '@angular/core';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { XtreamStartupRefreshService } from '@iptvnator/services/xtream-startup-refresh';
import {
    isXtreamAccountPlaylist,
    normalizeXtreamContentTypes,
    type PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';

export const XTREAM_LIVE_REFRESH_MIN_INTERVAL_MS = 15 * 60 * 1000;
export const XTREAM_LIVE_REFRESH_FAILURE_COOLDOWN_MS = 60 * 1000;

function connectionKey(source: PlaylistMeta): string {
    return [
        source._id,
        source.serverUrl,
        source.username,
        source.password,
        source.userAgent,
    ].join('\u0000');
}

/** Refreshes an opted-in Xtream live catalog when the source is used, not at startup. */
@Injectable({ providedIn: 'root' })
export class XtreamLiveRefreshOnUseService {
    private readonly injector = inject(Injector);
    private readonly running = new Set<string>();
    private readonly nextAttemptAt = new Map<string, number>();

    /** Fire and forget: callers never wait for the provider. */
    ensureFresh(playlistId: string | null | undefined): void {
        if (
            !playlistId ||
            window.electron?.isXtreamLiveRefreshOnUseDisabled?.()
        )
            return;
        // Hosts without the playlist store (isolated component specs) have nothing to refresh.
        const store = this.injector.get(Store, null);
        const source = store
            ?.selectSignal(selectAllPlaylistsMeta)()
            .find((playlist) => playlist._id === playlistId);
        if (!source || !this.isEligible(source)) return;
        const key = connectionKey(source);
        if (
            this.running.has(key) ||
            Date.now() < (this.nextAttemptAt.get(key) ?? 0)
        )
            return;
        this.running.add(key);
        void this.run(source, key);
    }

    private isEligible(source: PlaylistMeta): boolean {
        return (
            this.injector.get(RuntimeCapabilitiesService)
                .supportsXtreamSqliteDataSource &&
            source.autoRefresh === true &&
            !source.portalUrl &&
            isXtreamAccountPlaylist(source) &&
            normalizeXtreamContentTypes(source.xtreamContentTypes).includes(
                'live'
            )
        );
    }

    private async run(source: PlaylistMeta, key: string): Promise<void> {
        let wait = XTREAM_LIVE_REFRESH_MIN_INTERVAL_MS;
        try {
            if (
                await this.injector
                    .get(XtreamStartupRefreshService)
                    .refreshLive(source)
            )
                await this.publish(source);
        } catch {
            wait = XTREAM_LIVE_REFRESH_FAILURE_COOLDOWN_MS;
        } finally {
            this.nextAttemptAt.set(key, Date.now() + wait);
            this.running.delete(key);
        }
    }

    private async publish(source: PlaylistMeta): Promise<void> {
        window.dispatchEvent(new Event('iptvnator-favorites-changed'));
        window.dispatchEvent(new Event('iptvnator-history-changed'));
        const updateDate = Date.now();
        const saved = await firstValueFrom(
            this.injector
                .get(PlaylistsService)
                .updatePlaylistMetaIfCurrent(
                    { _id: source._id, updateDate },
                    (current) =>
                        current?.serverUrl === source.serverUrl &&
                        current.username === source.username &&
                        current.password === source.password &&
                        current.userAgent === source.userAgent
                )
        );
        if (!saved) return;
        this.injector
            .get(XtreamStartupRefreshService)
            .recordUpdate(source._id, updateDate);
        this.injector.get(Store).dispatch(
            PlaylistActions.xtreamStartupRefreshCommitted({
                playlistId: source._id,
                updateDate,
            })
        );
    }
}
