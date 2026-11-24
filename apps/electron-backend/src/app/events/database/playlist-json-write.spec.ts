type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
type IpcListener = (event: { returnValue?: unknown }) => void;

const mockRegisteredHandlers = new Map<string, IpcHandler>();
const mockRegisteredListeners = new Map<string, IpcListener>();
const mockWorkerRequest = jest.fn();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn((channel: string, handler: IpcHandler) => {
            mockRegisteredHandlers.set(channel, handler);
        }),
        on: jest.fn((channel: string, listener: IpcListener) => {
            mockRegisteredListeners.set(channel, listener);
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

const KILL_SWITCH = 'IPTVNATOR_DISABLE_JSON_PLAYLIST_WRITE';
const JSON_ENVELOPE = {
    format: 'json',
    json: '{"_id":"playlist-1","title":"Synthetic"}',
};

async function upsertPlaylist(...args: unknown[]): Promise<unknown> {
    const handler = mockRegisteredHandlers.get('DB_UPSERT_APP_PLAYLIST');
    if (!handler) {
        throw new Error('DB_UPSERT_APP_PLAYLIST handler is not registered');
    }
    return handler({ sender: { isDestroyed: () => false } }, ...args);
}

function readWriteEnabled(): unknown {
    const listener = mockRegisteredListeners.get('JSON_PLAYLIST_WRITE_ENABLED');
    if (!listener) {
        throw new Error('JSON_PLAYLIST_WRITE_ENABLED listener is not registered');
    }
    const event: { returnValue?: unknown } = {};
    listener(event);
    return event.returnValue;
}

describe('DB_UPSERT_APP_PLAYLIST JSON text write', () => {
    beforeEach(async () => {
        jest.resetModules();
        mockRegisteredHandlers.clear();
        mockRegisteredListeners.clear();
        mockWorkerRequest.mockReset().mockResolvedValue({ success: true });
        delete process.env[KILL_SWITCH];
        await import('./playlist.events');
    });

    afterAll(() => {
        delete process.env[KILL_SWITCH];
    });

    it('forwards the JSON envelope unchanged to the worker', async () => {
        await upsertPlaylist(JSON_ENVELOPE);

        expect(mockWorkerRequest).toHaveBeenLastCalledWith(
            'DB_UPSERT_APP_PLAYLIST',
            JSON_ENVELOPE
        );
    });

    it('keeps forwarding the object write unchanged', async () => {
        const playlist = { _id: 'playlist-1', title: 'Synthetic' };

        await upsertPlaylist(playlist);

        expect(mockWorkerRequest).toHaveBeenLastCalledWith(
            'DB_UPSERT_APP_PLAYLIST',
            playlist
        );
    });

    it('reports the write as enabled while the kill switch is unset', () => {
        expect(readWriteEnabled()).toBe(true);
    });

    it('reports the write as disabled per call while the kill switch is set', () => {
        process.env[KILL_SWITCH] = '1';
        expect(readWriteEnabled()).toBe(false);

        delete process.env[KILL_SWITCH];
        expect(readWriteEnabled()).toBe(true);
    });
});
