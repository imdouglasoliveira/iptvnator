import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, Injector } from '@angular/core';
import { LowEndMode, VideoPlayer } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';
import { SettingsStore } from './settings-store.service';

export const LOW_END_BODY_CLASS = 'low-end';

export function resolveLowEndMode(
    mode: LowEndMode | undefined,
    lowEndHardware: boolean
): boolean {
    if (mode === 'on') {
        return true;
    }
    if (mode === 'off') {
        return false;
    }
    return lowEndHardware;
}

@Injectable({ providedIn: 'root' })
export class LowEndModeService {
    private readonly document = inject(DOCUMENT);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settings = inject(SettingsStore);
    private readonly injector = inject(Injector);
    private started = false;

    effective(): boolean {
        return resolveLowEndMode(
            this.settings.lowEndMode?.(),
            this.runtime.lowEndHardware
        );
    }

    /** Applies the body class and runs the one-time VLC default, after settings load. */
    async start(): Promise<void> {
        if (this.started) {
            return;
        }
        this.started = true;
        effect(
            () => {
                this.document.body.classList.toggle(
                    LOW_END_BODY_CLASS,
                    this.effective()
                );
            },
            { injector: this.injector }
        );
        await this.settings.loadSettings();
        await this.migratePlayerToVlc();
    }

    private async migratePlayerToVlc(): Promise<void> {
        if (
            !this.effective() ||
            this.settings.lowEndPlayerMigrated?.() === true
        ) {
            return;
        }
        if (!(await this.runtime.isVlcInstalled())) {
            return;
        }
        // The user may have changed mode or player while the probe ran.
        if (!this.effective() || this.settings.lowEndPlayerMigrated?.() === true) {
            return;
        }
        await this.settings.updateSettings({
            player: VideoPlayer.VLC,
            lowEndPlayerMigrated: true,
        });
    }
}
