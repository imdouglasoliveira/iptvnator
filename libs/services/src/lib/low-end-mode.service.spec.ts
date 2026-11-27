import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LowEndMode, VideoPlayer } from '@iptvnator/shared/interfaces';
import {
    LOW_END_BODY_CLASS,
    LowEndModeService,
    resolveLowEndMode,
} from './low-end-mode.service';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';
import { SettingsStore } from './settings-store.service';

describe('resolveLowEndMode', () => {
    it.each([
        ['auto', true, true],
        ['auto', false, false],
        [undefined, true, true],
        ['on', false, true],
        ['off', true, false],
    ] as [LowEndMode | undefined, boolean, boolean][])(
        'mode %s with weak hardware %s gives %s',
        (mode, hardware, expected) => {
            expect(resolveLowEndMode(mode, hardware)).toBe(expected);
        }
    );
});

describe('LowEndModeService', () => {
    let mode: ReturnType<typeof signal<LowEndMode>>;
    let playerDone: ReturnType<typeof signal<boolean>>;
    let updateSettings: jest.Mock;
    let runtime: { lowEndHardware: boolean; isVlcInstalled: jest.Mock };

    function create(): LowEndModeService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: SettingsStore,
                    useValue: {
                        lowEndMode: mode,
                        lowEndPlayerMigrated: playerDone,
                        loadSettings: jest.fn().mockResolvedValue(undefined),
                        updateSettings,
                    },
                },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
            ],
        });
        return TestBed.inject(LowEndModeService);
    }

    beforeEach(() => {
        mode = signal<LowEndMode>('auto');
        playerDone = signal(false);
        updateSettings = jest.fn().mockResolvedValue(undefined);
        runtime = {
            lowEndHardware: false,
            isVlcInstalled: jest.fn().mockResolvedValue(true),
        };
        document.body.classList.remove(LOW_END_BODY_CLASS);
    });

    afterEach(() => {
        document.body.classList.remove(LOW_END_BODY_CLASS);
    });

    it('turns on for weak hardware in auto mode', () => {
        runtime.lowEndHardware = true;
        expect(create().effective()).toBe(true);
    });

    it('stays off for strong hardware in auto mode', () => {
        expect(create().effective()).toBe(false);
    });

    it('lets on and off win over the hardware check', () => {
        runtime.lowEndHardware = false;
        const service = create();
        mode.set('on');
        expect(service.effective()).toBe(true);
        runtime.lowEndHardware = true;
        mode.set('off');
        expect(service.effective()).toBe(false);
    });

    it('toggles the body class with the effective mode', async () => {
        const service = create();
        await service.start();
        TestBed.tick();
        expect(document.body.classList.contains(LOW_END_BODY_CLASS)).toBe(
            false
        );
        mode.set('on');
        TestBed.tick();
        expect(document.body.classList.contains(LOW_END_BODY_CLASS)).toBe(true);
        mode.set('off');
        TestBed.tick();
        expect(document.body.classList.contains(LOW_END_BODY_CLASS)).toBe(
            false
        );
    });

    it('moves the player to VLC once when the light mode is on and VLC is installed', async () => {
        runtime.lowEndHardware = true;
        await create().start();
        expect(updateSettings).toHaveBeenCalledTimes(1);
        expect(updateSettings).toHaveBeenCalledWith({
            player: VideoPlayer.VLC,
            lowEndPlayerMigrated: true,
        });
    });

    it('does not repeat the move once done, so the user choice stays', async () => {
        runtime.lowEndHardware = true;
        playerDone.set(true);
        await create().start();
        expect(updateSettings).not.toHaveBeenCalled();
        expect(runtime.isVlcInstalled).not.toHaveBeenCalled();
    });

    it('does not move the player with the light mode off', async () => {
        runtime.lowEndHardware = true;
        mode.set('off');
        await create().start();
        expect(updateSettings).not.toHaveBeenCalled();
    });

    it('does not move the player on strong hardware in auto mode', async () => {
        await create().start();
        expect(updateSettings).not.toHaveBeenCalled();
    });

    it('leaves the player alone when VLC is not installed', async () => {
        runtime.lowEndHardware = true;
        runtime.isVlcInstalled.mockResolvedValue(false);
        await create().start();
        expect(updateSettings).not.toHaveBeenCalled();
    });
});
