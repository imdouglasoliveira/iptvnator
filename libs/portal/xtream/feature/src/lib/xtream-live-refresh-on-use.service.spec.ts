import { TestBed } from '@angular/core/testing';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { XtreamStartupRefreshService } from '@iptvnator/services/xtream-startup-refresh';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import {
    XTREAM_LIVE_REFRESH_FAILURE_COOLDOWN_MS,
    XTREAM_LIVE_REFRESH_MIN_INTERVAL_MS,
    XtreamLiveRefreshOnUseService,
} from './xtream-live-refresh-on-use.service';

const source: PlaylistMeta = {
    _id: 'source',
    title: 'Sample source',
    autoRefresh: true,
    serverUrl: 'http://example.test',
    username: 'user',
    password: 'pass',
    xtreamContentTypes: ['live'],
    count: 0,
    importDate: '2026-01-01',
};

describe('XtreamLiveRefreshOnUseService', () => {
    let now: number;
    let refreshLive: jest.Mock;
    let sources: PlaylistMeta[];
    let sqlite: boolean;
    let disabled: boolean | undefined;
    const bridge = window as unknown as { electron?: unknown };

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const service = () => TestBed.inject(XtreamLiveRefreshOnUseService);

    beforeEach(() => {
        now = 1_000_000;
        sources = [source];
        sqlite = true;
        disabled = undefined;
        refreshLive = jest.fn().mockResolvedValue(true);
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        bridge.electron = {
            isXtreamLiveRefreshOnUseDisabled: () => disabled,
        };
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: Store,
                    useValue: {
                        selectSignal: () => () => sources,
                        dispatch: jest.fn(),
                    },
                },
                {
                    provide: XtreamStartupRefreshService,
                    useValue: { refreshLive, recordUpdate: jest.fn() },
                },
                {
                    provide: PlaylistsService,
                    useValue: { updatePlaylistMetaIfCurrent: () => of(source) },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsXtreamSqliteDataSource() {
                            return sqlite;
                        },
                    },
                },
            ],
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete bridge.electron;
    });

    it('does not refresh until the source is used', async () => {
        service();
        await flush();
        expect(refreshLive).not.toHaveBeenCalled();
    });

    it('refreshes in the background on first use without blocking the caller', async () => {
        refreshLive.mockReturnValue(new Promise(() => undefined));
        expect(service().ensureFresh('source')).toBeUndefined();
        await flush();
        expect(refreshLive).toHaveBeenCalledTimes(1);
    });

    it('shares a refresh that is already running', async () => {
        refreshLive.mockReturnValue(new Promise(() => undefined));
        service().ensureFresh('source');
        service().ensureFresh('source');
        await flush();
        expect(refreshLive).toHaveBeenCalledTimes(1);
    });

    it('waits the minimum interval after a success', async () => {
        service().ensureFresh('source');
        await flush();
        now += XTREAM_LIVE_REFRESH_MIN_INTERVAL_MS - 1;
        service().ensureFresh('source');
        await flush();
        expect(refreshLive).toHaveBeenCalledTimes(1);
        now += 1;
        service().ensureFresh('source');
        await flush();
        expect(refreshLive).toHaveBeenCalledTimes(2);
    });

    it('uses the shorter cooldown after a failure', async () => {
        refreshLive.mockRejectedValueOnce(new Error('offline'));
        service().ensureFresh('source');
        await flush();
        now += XTREAM_LIVE_REFRESH_FAILURE_COOLDOWN_MS - 1;
        service().ensureFresh('source');
        await flush();
        expect(refreshLive).toHaveBeenCalledTimes(1);
        now += 1;
        service().ensureFresh('source');
        await flush();
        expect(refreshLive).toHaveBeenCalledTimes(2);
    });

    it('skips sources that did not opt in or lack live content', async () => {
        sources = [{ ...source, autoRefresh: false }];
        service().ensureFresh('source');
        sources = [{ ...source, xtreamContentTypes: ['vod'] }];
        service().ensureFresh('source');
        sources = [source];
        sqlite = false;
        service().ensureFresh('source');
        sqlite = true;
        service().ensureFresh('missing');
        await flush();
        expect(refreshLive).not.toHaveBeenCalled();
    });

    it('does nothing when the kill switch restores the startup refresh', async () => {
        disabled = true;
        service().ensureFresh('source');
        await flush();
        expect(refreshLive).not.toHaveBeenCalled();
    });

    it('keeps the new behavior when there is no Electron bridge', async () => {
        delete bridge.electron;
        service().ensureFresh('source');
        await flush();
        expect(refreshLive).toHaveBeenCalledTimes(1);
    });
});
