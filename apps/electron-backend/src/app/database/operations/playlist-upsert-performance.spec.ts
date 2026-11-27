import {
    APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE,
    type AppPlaylistUpsertPerformancePhase,
    type PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';
import { M3U_CATALOG_SNAPSHOT_KILL_SWITCH } from '@iptvnator/shared/interfaces/ipc-commands';

import type { AppDatabase } from '../database.types';
import {
    type AppPlaylistUpsertPhaseCapture,
    upsertAppPlaylist,
} from './playlist.operations';

function createDatabaseMock() {
    const run = jest.fn();
    const onConflictDoUpdate = jest.fn(() => ({ run }));
    const values = jest.fn(() => ({ onConflictDoUpdate }));
    const insert = jest.fn(() => ({ values }));
    const get = jest
        .fn()
        .mockReturnValueOnce({ revision: 6 })
        .mockReturnValueOnce({ revision: 7 });
    const where = jest.fn(() => ({ get }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));
    const tx = { insert, select };
    const commit = jest.fn();
    const transaction = jest.fn((execute: (database: typeof tx) => unknown) => {
        const result = execute(tx);
        commit();
        return result;
    });

    return {
        db: { insert, select, transaction } as unknown as AppDatabase,
        commit,
        get,
        run,
        transaction,
    };
}

describe('app playlist upsert performance boundaries', () => {
    const playlist = {
        _id: 'synthetic-playlist',
        playlist: {
            items: [{ id: 'channel-1' }, { id: 'channel-2' }],
        },
        title: 'Synthetic playlist',
        type: 'm3u-url',
        url: 'http://127.0.0.1:43210/synthetic-performance.m3u',
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('executes one autocommit run when snapshots are disabled', async () => {
        jest.replaceProperty(process, 'env', {
            ...process.env,
            [M3U_CATALOG_SNAPSHOT_KILL_SWITCH]: '1',
            IPTVNATOR_DISABLE_M3U_PRIORITY_OPEN: '1',
        });
        const { db, get, run, transaction } = createDatabaseMock();
        const schedule = jest.fn();

        await expect(
            upsertAppPlaylist(db, playlist, undefined, schedule)
        ).resolves.toEqual({ success: true });
        expect(run).toHaveBeenCalledTimes(1);
        expect(transaction).not.toHaveBeenCalled();
        expect(get).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
    });

    it('separates row/JSON serialization from SQLite without rescanning the payload for metadata', async () => {
        jest.replaceProperty(process, 'env', {
            ...process.env,
            [M3U_CATALOG_SNAPSHOT_KILL_SWITCH]: '0',
        });
        const { db, commit, get, run, transaction } = createDatabaseMock();
        const schedule = jest.fn();
        const byteLength = jest.spyOn(Buffer, 'byteLength');
        const phases: Array<{
            metadata: PerformancePhaseMetadata | undefined;
            phase: AppPlaylistUpsertPerformancePhase;
        }> = [];
        const capture: AppPlaylistUpsertPhaseCapture = {
            async captureAsync(phase, execute, metadata) {
                const result = await execute();
                phases.push({
                    metadata: metadata?.(result),
                    phase,
                });
                return result;
            },
            captureSync(phase, execute, metadata) {
                const result = execute();
                phases.push({
                    metadata: metadata?.(result),
                    phase,
                });
                return result;
            },
        };

        await expect(
            upsertAppPlaylist(db, playlist, capture, schedule)
        ).resolves.toEqual({ success: true });

        expect(phases).toEqual([
            {
                metadata: { itemCount: 2 },
                phase: APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SERIALIZE_PLAYLIST,
            },
            {
                metadata: { itemCount: 1 },
                phase: APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE,
            },
        ]);
        expect(byteLength).not.toHaveBeenCalled();
        expect(run).toHaveBeenCalledTimes(1);
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
            behavior: 'immediate',
        });
        expect(get).toHaveBeenCalledTimes(2);
        const [beforeWrite, afterWrite] = get.mock.invocationCallOrder;
        expect(beforeWrite).toBeLessThan(run.mock.invocationCallOrder[0]);
        expect(run.mock.invocationCallOrder[0]).toBeLessThan(afterWrite);
        expect(afterWrite).toBeLessThan(commit.mock.invocationCallOrder[0]);
        expect(schedule).toHaveBeenCalledTimes(1);
        expect(schedule).toHaveBeenCalledWith(db, {
            playlistId: playlist._id,
            revision: 7,
            channels: playlist.playlist.items,
        });
        expect(commit.mock.invocationCallOrder[0]).toBeLessThan(
            schedule.mock.invocationCallOrder[0]
        );
    });
});
