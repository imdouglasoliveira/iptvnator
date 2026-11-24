import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of, Subject } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import { SettingsStore } from '@iptvnator/services';
import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import {
    M3U_EPG_REFRESH_INTERVAL_MS,
    M3uActiveChannelEpgService,
} from './m3u-active-channel-epg.service';

function channel(name: string, logo = ''): Channel {
    return {
        id: name,
        url: `https://example.test/${name}.m3u8`,
        name,
        group: { title: 'Group' },
        tvg: { id: '', name: '', url: '', logo, rec: '' },
        http: { referrer: '', 'user-agent': '', origin: '' },
        radio: 'false',
    };
}

function program(title: string): EpgProgram {
    return {
        start: '2026-04-11T10:00:00.000Z',
        stop: '2026-04-11T11:00:00.000Z',
        channel: 'x',
        title,
        desc: null,
        category: null,
    };
}

describe('M3uActiveChannelEpgService', () => {
    let service: M3uActiveChannelEpgService;
    let active: ReturnType<typeof signal<Channel | undefined>>;
    let offset: ReturnType<typeof signal<number>>;
    let epg: {
        getCurrentProgramsForChannels: jest.Mock;
        getChannelMetadataForChannels: jest.Mock;
    };
    let maxKeysPerBatch: () => number;

    beforeEach(() => {
        active = signal<Channel | undefined>(undefined);
        offset = signal(0);
        epg = {
            getCurrentProgramsForChannels: jest.fn(() => of(new Map())),
            getChannelMetadataForChannels: jest.fn(() => of(new Map())),
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: EpgService, useValue: epg },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: offset },
                },
                { provide: Store, useValue: { selectSignal: () => active } },
            ],
        });
        service = TestBed.inject(M3uActiveChannelEpgService);
        maxKeysPerBatch = () =>
            Math.max(
                0,
                ...[
                    ...epg.getCurrentProgramsForChannels.mock.calls,
                    ...epg.getChannelMetadataForChannels.mock.calls,
                ].map(([keys]) => (keys as string[]).length)
            );
    });

    it('never queries without an active channel', () => {
        service.refresh([]);
        expect(epg.getCurrentProgramsForChannels).not.toHaveBeenCalled();
        expect(epg.getChannelMetadataForChannels).not.toHaveBeenCalled();
    });

    it('queries at most one key per automatic batch, however large the catalogue', () => {
        // The catalogue is irrelevant to the owner: it only ever sees the active channel.
        active.set(channel('Channel 380000'));
        service.refresh(['https://example.test/guide.xml']);
        service.refresh(['https://example.test/guide.xml'], true);
        expect(maxKeysPerBatch()).toBeLessThanOrEqual(1);
        expect(epg.getCurrentProgramsForChannels).toHaveBeenCalledWith(
            ['Channel 380000'],
            { sourceUrls: ['https://example.test/guide.xml'] }
        );
    });

    it('is a single query when two list instances ask for the same channel', () => {
        active.set(channel('News'));
        service.refresh([]);
        service.refresh([]);
        expect(epg.getCurrentProgramsForChannels).toHaveBeenCalledTimes(1);
    });

    it('asks for metadata only when tvg-logo is missing, and not on timer revalidation', () => {
        active.set(channel('Plain'));
        service.refresh([]);
        service.refresh([], true);
        expect(epg.getChannelMetadataForChannels).toHaveBeenCalledTimes(1);

        epg.getChannelMetadataForChannels.mockClear();
        active.set(channel('Branded', 'https://example.test/logo.png'));
        service.refresh([]);
        expect(epg.getChannelMetadataForChannels).not.toHaveBeenCalled();
    });

    it('falls back to the channel name when it has no tvg-id or tvg-name', () => {
        active.set(channel('Name Only'));
        service.refresh([]);
        expect(epg.getCurrentProgramsForChannels).toHaveBeenCalledWith(
            ['Name Only'],
            undefined
        );
    });

    it('refetches the active channel when the display offset changes', () => {
        active.set(channel('News'));
        service.refresh([]);
        offset.set(60);
        service.refresh([]);
        expect(epg.getCurrentProgramsForChannels).toHaveBeenCalledTimes(2);
    });

    it('drops a late response that belongs to the previous channel', () => {
        const late = new Subject<Map<string, EpgProgram | null>>();
        epg.getCurrentProgramsForChannels
            .mockReturnValueOnce(late.asObservable())
            .mockReturnValueOnce(of(new Map([['B', program('B now')]])));
        active.set(channel('A'));
        service.refresh([]);
        active.set(channel('B'));
        service.refresh([]);
        late.next(new Map([['A', program('A late')]]));
        expect(service.programs().get('A')).toBeUndefined();
        expect(service.programs().get('B')?.title).toBe('B now');
    });

    it('keeps program and metadata failures independent', () => {
        epg.getCurrentProgramsForChannels.mockReturnValue(
            new Subject().asObservable()
        );
        epg.getChannelMetadataForChannels.mockReturnValue(
            of(
                new Map([
                    ['Plain', { iconUrl: ' https://example.test/i.png ' }],
                ])
            )
        );
        active.set(channel('Plain'));
        service.refresh([]);
        expect(service.icons().get('Plain')).toBe('https://example.test/i.png');
    });

    it('revalidates only the active channel on the 60 s timer', () => {
        jest.useFakeTimers();
        try {
            active.set(channel('News'));
            const release = service.acquire();
            const release2 = service.acquire();
            service.refresh([]);
            epg.getCurrentProgramsForChannels.mockClear();
            jest.advanceTimersByTime(M3U_EPG_REFRESH_INTERVAL_MS);
            expect(epg.getCurrentProgramsForChannels).toHaveBeenCalledTimes(1);
            expect(maxKeysPerBatch()).toBe(1);
            release();
            release2();
            epg.getCurrentProgramsForChannels.mockClear();
            jest.advanceTimersByTime(M3U_EPG_REFRESH_INTERVAL_MS * 2);
            expect(epg.getCurrentProgramsForChannels).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });
});
