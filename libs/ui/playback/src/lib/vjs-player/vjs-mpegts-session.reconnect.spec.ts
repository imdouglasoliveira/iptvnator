const createPlayerMock = jest.fn();
let VjsMpegTsSession: typeof import('./vjs-mpegts-session').VjsMpegTsSession;

jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: createPlayerMock,
        isSupported: () => true,
    },
}));

const URL = 'https://example.test/live/stream.ts';

describe('VjsMpegTsSession live reconnect', () => {
    beforeAll(async () => {
        ({ VjsMpegTsSession } = await import('./vjs-mpegts-session'));
    });

    beforeEach(() => {
        createPlayerMock.mockReset();
        jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    it('recreates the engine on the same channel and recovers on the second attempt', () => {
        const { session, players, video, emit } = setup();
        session.start(URL, video);

        players[0].emit('error', 'NetworkError', 'UnrecoverableEarlyEof', {});
        expect(emit).not.toHaveBeenCalled();
        expect(session.reconnecting()).toBe(true);
        jest.advanceTimersByTime(1000);

        expect(players).toHaveLength(2);
        expect(players[0].destroy).toHaveBeenCalledTimes(1);
        expect(createPlayerMock).toHaveBeenLastCalledWith({
            type: 'mpegts',
            isLive: true,
            url: URL,
        });
        expect(players[1].attachMediaElement).toHaveBeenCalledWith(video);

        players[1].emit('error', 'NetworkError', 'Exception', {});
        jest.advanceTimersByTime(2000);
        expect(players).toHaveLength(3);

        video.dispatchEvent(new Event('playing'));
        expect(session.reconnecting()).toBe(false);
        expect(emit).not.toHaveBeenCalled();
    });

    it('emits the terminal connection-interrupted diagnostic only after exhausting the budget', () => {
        const { session, players, video, emit } = setup();
        session.start(URL, video);

        players[0].emit('error', 'NetworkError', 'UnrecoverableEarlyEof', {});
        for (const wait of [1000, 2000, 4000]) {
            jest.advanceTimersByTime(wait);
            expect(emit).not.toHaveBeenCalled();
            players[players.length - 1].emit(
                'error',
                'NetworkError',
                'UnrecoverableEarlyEof',
                {}
            );
        }

        expect(players).toHaveLength(4);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'connection-interrupted',
                mpegTs: expect.objectContaining({
                    stage: 'loader',
                    failure: 'truncated-stream',
                }),
            })
        );
    });

    it('ignores a duplicate error while the first recovery is waiting', () => {
        const { session, players, video } = setup();
        session.start(URL, video);

        players[0].emit('error', 'NetworkError', 'UnrecoverableEarlyEof', {});
        players[0].emit('error', 'NetworkError', 'UnrecoverableEarlyEof', {});
        jest.advanceTimersByTime(10_000);

        expect(players).toHaveLength(2);
    });

    it('does not resume the previous channel after a channel change during the wait', () => {
        const { session, players, video } = setup();
        session.start(URL, video);
        players[0].emit('error', 'NetworkError', 'UnrecoverableEarlyEof', {});

        session.start('https://example.test/live/other.ts', video);
        jest.advanceTimersByTime(60_000);

        expect(players).toHaveLength(2);
        expect(createPlayerMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                url: 'https://example.test/live/other.ts',
            })
        );
    });

    it('cancels the pending recovery on destroy', () => {
        const { session, players, video, emit } = setup();
        session.start(URL, video);
        players[0].emit('error', 'NetworkError', 'UnrecoverableEarlyEof', {});

        session.destroy();
        jest.advanceTimersByTime(60_000);

        expect(players).toHaveLength(1);
        expect(emit).not.toHaveBeenCalled();
        expect(session.reconnecting()).toBe(false);
    });

    it('does not reconnect VOD playback', () => {
        const { session, players, video, emit } = setup({ isLive: false });
        session.start(URL, video);

        players[0].emit('error', 'NetworkError', 'UnrecoverableEarlyEof', {});
        jest.advanceTimersByTime(10_000);

        expect(players).toHaveLength(1);
        expect(emit).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['MediaError', 'FormatError'],
        ['MediaError', 'MediaMSEError'],
        ['MediaError', 'CodecUnsupported'],
    ])('does not reconnect a real decode error (%s %s)', (type, details) => {
        const { session, players, video, emit } = setup();
        session.start(URL, video);

        players[0].emit('error', type, details, {});
        jest.advanceTimersByTime(10_000);

        expect(players).toHaveLength(1);
        expect(emit).toHaveBeenCalledWith(
            expect.objectContaining({
                code: expect.stringMatching(/decode|codec/),
            })
        );
    });

    it('does not reconnect on authorization failures', () => {
        const { session, players, video, emit } = setup();
        session.start(URL, video);

        players[0].emit('error', 'NetworkError', 'HttpStatusCodeInvalid', {
            code: 403,
        });
        jest.advanceTimersByTime(10_000);

        expect(players).toHaveLength(1);
        expect(emit).toHaveBeenCalledTimes(1);
    });

    it('keeps the legacy terminal behavior when the kill switch is on', () => {
        const { session, players, video, emit } = setup({ enabled: false });
        session.start(URL, video);

        players[0].emit('error', 'NetworkError', 'UnrecoverableEarlyEof', {});
        jest.advanceTimersByTime(10_000);

        expect(players).toHaveLength(1);
        expect(emit).toHaveBeenCalledTimes(1);
    });

    it('honors the preload kill switch when no override is given', () => {
        const { players, video, emit } = setup();
        const session = new VjsMpegTsSession({
            player: () => ({ duration: jest.fn() }),
            isLive: () => true,
            emitPlaybackIssue: emit,
        });
        (window as unknown as { electron?: unknown }).electron = {
            isMpegTsLiveReconnectDisabled: () => true,
        };
        try {
            session.start(URL, video);
            players[0].emit(
                'error',
                'NetworkError',
                'UnrecoverableEarlyEof',
                {}
            );
            jest.advanceTimersByTime(10_000);
        } finally {
            delete (window as unknown as { electron?: unknown }).electron;
        }

        expect(players).toHaveLength(1);
        expect(emit).toHaveBeenCalledTimes(1);
    });
});

function setup(options: { isLive?: boolean; enabled?: boolean } = {}) {
    const players: ReturnType<typeof createMpegTsPlayer>[] = [];
    createPlayerMock.mockImplementation(() => {
        const player = createMpegTsPlayer();
        players.push(player);
        return player;
    });
    const emit = jest.fn();
    const session = new VjsMpegTsSession({
        player: () => ({ duration: jest.fn() }),
        isLive: () => options.isLive ?? true,
        emitPlaybackIssue: emit,
        isReconnectEnabled: () => options.enabled ?? true,
    });
    return {
        session,
        players,
        emit,
        video: document.createElement('video'),
    };
}

function createMpegTsPlayer() {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    return {
        attachMediaElement: jest.fn(),
        load: jest.fn(),
        play: jest.fn(),
        pause: jest.fn(),
        unload: jest.fn(),
        detachMediaElement: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
            const set = listeners.get(event) ?? new Set();
            set.add(listener);
            listeners.set(event, set);
        }),
        off: jest.fn(
            (event: string, listener: (...args: unknown[]) => void) => {
                listeners.get(event)?.delete(listener);
            }
        ),
        emit: (event: string, ...args: unknown[]) => {
            for (const listener of [...(listeners.get(event) ?? [])]) {
                listener(...args);
            }
        },
    };
}
