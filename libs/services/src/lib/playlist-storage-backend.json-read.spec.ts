import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    PlaylistDocumentStore,
    readDocumentPlaylist,
} from './playlist-storage-backend';

const playlist = {
    _id: 'playlist-1',
    title: 'Synthetic',
    playlist: { items: [{ id: 'a', url: 'https://example.test/a.ts' }] },
} as unknown as Playlist;

function createStore(
    overrides: Partial<PlaylistDocumentStore>
): PlaylistDocumentStore {
    return {
        dbGetAppPlaylist: jest.fn().mockResolvedValue(playlist),
        ...overrides,
    } as unknown as PlaylistDocumentStore;
}

describe('readDocumentPlaylist', () => {
    it('parses the JSON text read without the object read', async () => {
        const store = createStore({
            dbGetAppPlaylistJson: jest
                .fn()
                .mockResolvedValue(JSON.stringify(playlist)),
        });

        await expect(
            readDocumentPlaylist(store, 'playlist-1', 'op-1')
        ).resolves.toEqual(playlist);
        expect(store.dbGetAppPlaylistJson).toHaveBeenCalledWith(
            'playlist-1',
            'op-1'
        );
        expect(store.dbGetAppPlaylist).not.toHaveBeenCalled();
    });

    it('accepts the object when the main process disabled the text read', async () => {
        const store = createStore({
            dbGetAppPlaylistJson: jest.fn().mockResolvedValue(playlist),
        });

        await expect(
            readDocumentPlaylist(store, 'playlist-1')
        ).resolves.toBe(playlist);
    });

    it('falls back to the object read for stores without the text read', async () => {
        const store = createStore({});

        await expect(
            readDocumentPlaylist(store, 'playlist-1')
        ).resolves.toBe(playlist);
        expect(store.dbGetAppPlaylist).toHaveBeenCalledWith('playlist-1');
    });

    it('returns null for a missing playlist', async () => {
        const store = createStore({
            dbGetAppPlaylistJson: jest.fn().mockResolvedValue(null),
        });

        await expect(
            readDocumentPlaylist(store, 'missing')
        ).resolves.toBeNull();
    });
});
