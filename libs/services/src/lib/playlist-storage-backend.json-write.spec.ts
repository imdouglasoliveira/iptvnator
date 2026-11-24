import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    PlaylistDocumentStore,
    writeDocumentPlaylist,
} from './playlist-storage-backend';

const playlist = {
    _id: 'playlist-1',
    title: 'Synthetic',
    playlist: { items: [{ id: 'a', url: 'https://example.test/a.ts' }] },
} as unknown as Playlist;

const ok = { success: true };

function createStore(
    overrides: Partial<PlaylistDocumentStore>
): PlaylistDocumentStore {
    return {
        dbUpsertAppPlaylist: jest.fn().mockResolvedValue(ok),
        ...overrides,
    } as unknown as PlaylistDocumentStore;
}

describe('writeDocumentPlaylist', () => {
    it('sends the whole document as JSON text with the operation id', async () => {
        const store = createStore({
            dbUpsertAppPlaylistJson: jest.fn().mockResolvedValue(ok),
        });

        await expect(
            writeDocumentPlaylist(store, playlist, 'op-1')
        ).resolves.toEqual(ok);
        expect(store.dbUpsertAppPlaylistJson).toHaveBeenCalledWith(
            JSON.stringify(playlist),
            'op-1'
        );
        expect(store.dbUpsertAppPlaylist).not.toHaveBeenCalled();
    });

    it('falls back to the object write for stores without the text write', async () => {
        const store = createStore({});

        await writeDocumentPlaylist(store, playlist);

        expect(store.dbUpsertAppPlaylist).toHaveBeenCalledWith(playlist);
    });

    it('passes the operation id to the object write when it is given', async () => {
        const store = createStore({});

        await writeDocumentPlaylist(store, playlist, 'op-2');

        expect(store.dbUpsertAppPlaylist).toHaveBeenCalledWith(
            playlist,
            'op-2'
        );
    });

    it('serializes before the bridge call so the bridge only receives text', async () => {
        const store = createStore({
            dbUpsertAppPlaylistJson: jest.fn().mockResolvedValue(ok),
        });

        await writeDocumentPlaylist(store, playlist);

        const [argument] = (store.dbUpsertAppPlaylistJson as jest.Mock).mock
            .calls[0];
        expect(typeof argument).toBe('string');
        expect(JSON.parse(argument)).toEqual(playlist);
    });
    it('keeps the object write while the kill switch reports disabled', async () => {
        const store = createStore({
            dbUpsertAppPlaylistJson: jest.fn().mockResolvedValue(ok),
            isJsonPlaylistWriteEnabled: jest.fn().mockReturnValue(false),
        });

        await writeDocumentPlaylist(store, playlist);

        expect(store.dbUpsertAppPlaylistJson).not.toHaveBeenCalled();
        expect(store.dbUpsertAppPlaylist).toHaveBeenCalledWith(playlist);
    });
});
