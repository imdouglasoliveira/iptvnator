import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { ChannelActions } from '@iptvnator/m3u-state';
import { M3uCatalogIndexService } from '@iptvnator/m3u-state/catalog-index';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import type { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import { defer, NEVER, of, Subject } from 'rxjs';
import { M3uPriorityOpenService } from './m3u-priority-open.service';
import { M3uWorkspaceRouteSession } from './m3u-workspace-route-session.service';

const channels = ['one', 'two', 'three'].map((id) => ({
    id,
    name: id,
    url: `https://example.test/${id}.ts`,
}));
const snapshot = {
    itemsRevision: 1,
    favoriteIds: channels.map(({ url }) => url),
    channels,
};

describe('M3uPriorityOpenService', () => {
    const publish = jest.fn();
    const readDocument = jest.fn();
    const readSnapshot = jest.fn();
    const nextFrame = jest.fn();
    const dispatch = jest.fn();
    const document = new Subject<unknown>();
    let enabled: boolean;

    beforeEach(() => {
        jest.resetAllMocks();
        enabled = true;
        nextFrame.mockResolvedValue(undefined);
        readSnapshot.mockResolvedValue(JSON.stringify(snapshot));
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { dbGetM3uFavoritesSnapshot: readSnapshot } as unknown as ElectronBridgeApi,
        });
        TestBed.configureTestingModule({
            providers: [
                M3uWorkspaceRouteSession,
                { provide: M3uCatalogIndexService, useValue: { prepareSnapshot: jest.fn() } },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        syncFromUrl: () => ({ provider: 'playlists', playlistId: 'synthetic', section: 'all' }),
                    },
                },
                { provide: Router, useValue: { events: NEVER, url: '/workspace/playlists/synthetic/all' } },
                { provide: Store, useValue: { dispatch, select: () => of({}), selectSignal: () => signal({}) } },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getM3uFavoriteChannels: () => defer(async () => readSnapshot()),
                        getPlaylist: readDocument,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: { optimizations: () => ({ priorityOpen: enabled }) },
                },
            ],
        });
    });

    afterEach(() => {
        delete (window as { electron?: unknown }).electron;
    });

    async function open(isCurrent = () => true) {
        const service = TestBed.inject(M3uPriorityOpenService);
        await service.open('synthetic', isCurrent, publish, nextFrame);
        if (isCurrent()) readDocument();
    }

    it('publishes all three favorites and yields to paint before asking for the document', async () => {
        const events: string[] = [];
        readSnapshot.mockImplementation(() => {
            events.push('snapshot');
            return JSON.stringify(snapshot);
        });
        publish.mockImplementation(() => events.push('favorites'));
        nextFrame.mockImplementation(async () => {
            events.push('paint');
            expect(readDocument).not.toHaveBeenCalled();
        });
        readDocument.mockImplementation(() => events.push('document'));

        await open();

        expect(events).toEqual(['snapshot', 'favorites', 'paint', 'document']);
        expect(publish.mock.calls[0][0].channels).toEqual(channels);
    });

    it.each(['setting', 'bridge'])('opens the document first with the %s disabled', async (disabled) => {
        if (disabled === 'setting') enabled = false;
        else delete (window as { electron?: unknown }).electron;
        await open();
        expect(readSnapshot).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(readDocument).toHaveBeenCalledTimes(1);
    });

    it.each([null, '{', JSON.stringify({ ...snapshot, channels: [] })])(
        'falls back to the document for %j',
        async (raw) => {
            readSnapshot.mockResolvedValue(raw);
            await open();
            expect(publish).not.toHaveBeenCalled();
            expect(readDocument).toHaveBeenCalledTimes(1);
        }
    );

    it('falls back after a rejected snapshot read and redacts the error', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            readSnapshot.mockRejectedValue(new Error(channels[0].url));
            await open();
            expect(publish).not.toHaveBeenCalled();
            expect(readDocument).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(JSON.stringify(warn.mock.calls)).not.toContain(channels[0].url);
        } finally {
            warn.mockRestore();
        }
    });

    it('ignores a snapshot from a route that has already been left', async () => {
        let current = true;
        readSnapshot.mockImplementation(() => {
            current = false;
            return JSON.stringify(snapshot);
        });
        await open(() => current);
        expect(publish).not.toHaveBeenCalled();
        expect(readDocument).not.toHaveBeenCalled();
    });

    it('replaces the preview in the route only after the document arrives', async () => {
        let startDocument!: () => void;
        const started = new Promise<void>((resolve) => { startDocument = resolve; });
        readDocument.mockImplementation(() => {
            startDocument();
            return document;
        });
        const service = TestBed.inject(M3uPriorityOpenService);
        const open = service.open.bind(service);
        const openSpy = jest.spyOn(service, 'open').mockImplementation(
            (id, current, publish) => open(id, current, publish, nextFrame)
        );
        nextFrame.mockImplementation(async () => {
            expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
                type: ChannelActions.setPriorityChannels.type,
                channels,
            }));
            expect(readDocument).not.toHaveBeenCalled();
        });
        try {
            TestBed.inject(M3uWorkspaceRouteSession);
            await started;
            expect(dispatch.mock.calls.some(([action]) =>
                action.type === ChannelActions.setChannels.type
            )).toBe(false);

            const full = [...channels, { id: 'extra', name: 'Extra', url: 'https://example.test/extra.ts' }];
            document.next({ playlist: { items: full }, favorites: snapshot.favoriteIds });
            await Promise.resolve();
            expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
                type: ChannelActions.setChannels.type,
                channels: full,
            }));
        } finally {
            openSpy.mockRestore();
        }
    });
});
