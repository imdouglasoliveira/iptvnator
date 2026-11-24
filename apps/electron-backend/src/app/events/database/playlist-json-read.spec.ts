type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const mockRegisteredHandlers = new Map<string, IpcHandler>();
const mockWorkerRequest = jest.fn();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn((channel: string, handler: IpcHandler) => {
            mockRegisteredHandlers.set(channel, handler);
        }),
    },
}));

jest.mock('../../services/database-worker-client', () => ({
    databaseWorkerClient: {
        request: (...args: unknown[]) => mockWorkerRequest(...args),
        cancel: jest.fn(),
    },
}));

jest.mock('../../database/connection', () => ({
    getDatabase: jest.fn().mockResolvedValue({}),
}));

const KILL_SWITCH = 'IPTVNATOR_DISABLE_JSON_PLAYLIST_READ';

async function readPlaylist(...args: unknown[]): Promise<void> {
    const handler = mockRegisteredHandlers.get('DB_GET_APP_PLAYLIST');
    if (!handler) {
        throw new Error('DB_GET_APP_PLAYLIST handler is not registered');
    }
    await handler({ sender: { isDestroyed: () => false } }, ...args);
}

describe('DB_GET_APP_PLAYLIST JSON text read', () => {
    beforeEach(async () => {
        jest.resetModules();
        mockRegisteredHandlers.clear();
        mockWorkerRequest.mockReset().mockResolvedValue(null);
        delete process.env[KILL_SWITCH];
        await import('./playlist.events');
    });

    afterAll(() => {
        delete process.env[KILL_SWITCH];
    });

    it('asks the worker for JSON text when the caller requests it', async () => {
        await readPlaylist('playlist-1', { format: 'json' });

        expect(mockWorkerRequest).toHaveBeenLastCalledWith(
            'DB_GET_APP_PLAYLIST',
            { playlistId: 'playlist-1', format: 'json' }
        );
    });

    it('asks for the object when the kill switch is set', async () => {
        process.env[KILL_SWITCH] = '1';

        await readPlaylist('playlist-1', { format: 'json' });

        expect(mockWorkerRequest).toHaveBeenLastCalledWith(
            'DB_GET_APP_PLAYLIST',
            { playlistId: 'playlist-1' }
        );
    });

    it('keeps the object read for callers without options', async () => {
        await readPlaylist('playlist-1');

        expect(mockWorkerRequest).toHaveBeenLastCalledWith(
            'DB_GET_APP_PLAYLIST',
            { playlistId: 'playlist-1' }
        );
    });
});
