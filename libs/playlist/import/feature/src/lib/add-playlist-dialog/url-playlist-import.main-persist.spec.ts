import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { DataService } from '@iptvnator/services';
import { Playlist, PlaylistUrlImportResult } from '@iptvnator/shared/interfaces';
import { createUrlPlaylistImport } from './url-playlist-import';

describe('URL playlist import persisted by the main process', () => {
    const draft = {
        playlistUrl: ' https://example.test/list.m3u ',
        playlistName: ' Synthetic list ',
        userAgent: ' SyntheticAgent/1.0 ',
        autoImportEpg: false,
    };
    let importPlaylistByUrl: jest.Mock;
    let fetchPlaylistDefinition: jest.Mock;
    let dispatch: jest.Mock;
    let completed: jest.Mock;

    function setup(result: PlaylistUrlImportResult) {
        importPlaylistByUrl = jest.fn().mockResolvedValue(result);
        fetchPlaylistDefinition = jest.fn();
        dispatch = jest.fn();
        completed = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                { provide: Store, useValue: { dispatch } },
                {
                    provide: DataService,
                    useValue: {
                        importPlaylistByUrl,
                        fetchPlaylistDefinition,
                        playlistImportRecovery: jest.fn(),
                    },
                },
            ],
        });
        return TestBed.runInInjectionContext(createUrlPlaylistImport);
    }

    it('dispatches only the meta when the main process persisted the playlist', async () => {
        const meta = { _id: 'synthetic-id', title: 'Synthetic list', count: 2 };
        const state = setup({ persisted: true, playlist: meta });

        await state.submit(draft, completed);

        expect(importPlaylistByUrl).toHaveBeenCalledWith(
            'https://example.test/list.m3u',
            {
                autoImportEpg: false,
                title: 'Synthetic list',
                userAgent: 'SyntheticAgent/1.0',
            }
        );
        expect(fetchPlaylistDefinition).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith(
            PlaylistActions.playlistImportedInMain({ playlist: meta })
        );
        expect(completed).toHaveBeenCalledTimes(1);
    });

    it('falls back to the renderer write when the kill switch returns the playlist', async () => {
        const playlist = {
            _id: 'synthetic-id',
            title: 'Synthetic list',
            playlist: { items: [] },
        } as Playlist;
        const state = setup({ persisted: false, playlist });

        await state.submit(draft, completed);

        expect(fetchPlaylistDefinition).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith(
            PlaylistActions.handleAddingPlaylistByUrl({
                isTemporary: false,
                playlist: {
                    ...playlist,
                    title: 'Synthetic list',
                    filename: 'Synthetic list',
                },
            })
        );
    });
});
