import {
    computed,
    inject,
    Injectable,
    InjectionToken,
    signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { EpgService } from '@iptvnator/epg/data-access';
import { resolveChannelEpgLookupKey, selectActive } from '@iptvnator/m3u-state';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { catchError, of, Subscription } from 'rxjs';

export const M3U_EPG_REFRESH_INTERVAL_MS = 60_000;

/** Reads the preload flag per call; the web runtime has no bridge, so it stays on. */
export function isM3uActiveOnlyEpgEnabled(): boolean {
    return !(
        (
            globalThis as {
                electron?: { isM3uActiveOnlyEpgDisabled?: () => boolean };
            }
        ).electron?.isM3uActiveOnlyEpgDisabled?.() ?? false
    );
}

/** Rows show the "no programme info" placeholder only when this returns true for them. */
export const M3U_EPG_PLACEHOLDER_POLICY = new InjectionToken<
    (selected: boolean) => boolean
>('M3U_EPG_PLACEHOLDER_POLICY');

/**
 * Single owner of the automatic EPG lookups of the M3U channel list: one key
 * (the active channel) per batch, however many list instances are mounted.
 */
@Injectable({ providedIn: 'root' })
export class M3uActiveChannelEpgService {
    private readonly store = inject(Store);
    private readonly epg = inject(EpgService);
    private readonly settings = inject(SettingsStore);
    private readonly activeChannel = this.store.selectSignal(selectActive);

    private readonly programMap = signal(new Map<string, EpgProgram | null>());
    private readonly iconMap = signal(new Map<string, string>());
    readonly programs = computed(() => this.programMap());
    readonly icons = computed(() => this.iconMap());

    private signature = '';
    private activeKey = '';
    private lastSourceUrls: string[] = [];
    private inFlight = false;
    private programSub?: Subscription;
    private metadataSub?: Subscription;
    private timer?: ReturnType<typeof setInterval>;
    private holders = 0;

    /** Keeps the 60 s revalidation alive while at least one list is mounted. */
    acquire(): () => void {
        this.holders++;
        this.timer ??= setInterval(
            () => this.refresh(this.lastSourceUrls, true),
            M3U_EPG_REFRESH_INTERVAL_MS
        );
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            if (--this.holders === 0 && this.timer) {
                clearInterval(this.timer);
                this.timer = undefined;
            }
        };
    }

    /**
     * Looks up the active channel only. A repeated call for the same channel,
     * scope and offset is a no-op unless forced (timer, EPG import), and a
     * forced call never doubles one already in flight.
     */
    refresh(sourceUrls: string[], force = false): void {
        this.lastSourceUrls = sourceUrls;
        const channel = this.activeChannel();
        const key = resolveChannelEpgLookupKey(channel);
        if (!channel || !key) {
            this.reset();
            return;
        }

        const offset = this.settings.resolvedEpgOffsetMinutes();
        const signature = JSON.stringify([key, sourceUrls, offset]);
        const changed = signature !== this.signature;
        if (!changed && (!force || this.inFlight)) {
            return;
        }

        this.programSub?.unsubscribe();
        if (changed) {
            this.metadataSub?.unsubscribe();
        }
        if (key !== this.activeKey) {
            this.programMap.set(new Map());
            this.iconMap.set(new Map());
        }
        this.signature = signature;
        this.activeKey = key;
        this.inFlight = true;

        const options = sourceUrls.length > 0 ? { sourceUrls } : undefined;
        this.programSub = this.epg
            .getCurrentProgramsForChannels([key], options)
            .pipe(catchError(() => of(new Map<string, EpgProgram | null>())))
            .subscribe({
                next: (map) => {
                    this.programMap.set(map);
                    this.inFlight = false;
                },
                complete: () => (this.inFlight = false),
            });

        // Metadata is only for a missing tvg-logo and is not re-asked every minute.
        if (changed && !channel.tvg?.logo?.trim()) {
            this.metadataSub = this.epg
                .getChannelMetadataForChannels([key], options)
                .pipe(catchError(() => of(new Map())))
                .subscribe((map) =>
                    this.iconMap.set(
                        new Map([[key, map.get(key)?.iconUrl?.trim() || '']])
                    )
                );
        }
    }

    private reset(): void {
        this.programSub?.unsubscribe();
        this.metadataSub?.unsubscribe();
        this.signature = '';
        this.activeKey = '';
        this.inFlight = false;
        if (this.programMap().size > 0) {
            this.programMap.set(new Map());
        }
        if (this.iconMap().size > 0) {
            this.iconMap.set(new Map());
        }
    }
}
