import { TestBed } from '@angular/core/testing';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import type {
    PlaybackPositionData,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { M3uSeriesExternalPositions } from './m3u-series-external-positions';
import { M3uSeriesPositionsService } from './m3u-series-positions.service';

const contentInfo: PlayerContentInfo = {
    playlistId: 'synthetic-playlist',
    seriesXtreamId: 500,
    contentXtreamId: 11,
    contentType: 'episode',
    seasonNumber: 1,
    episodeNumber: 1,
    m3uSeries: true,
};
const position = {
    ...contentInfo,
    sessionId: 'vlc-1',
    positionSeconds: 60,
    durationSeconds: 120,
};

async function setup() {
    let receive!: (data: PlaybackPositionData) => void;
    const unsubscribe = jest.fn();
    const dbSavePlaybackPosition = jest.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
        providers: [
            M3uSeriesExternalPositions,
            M3uSeriesPositionsService,
            {
                provide: PlaybackPositionRuntimeBridgeService,
                useValue: {
                    onPlaybackPositionUpdate: (callback: typeof receive) => {
                        receive = callback;
                        return unsubscribe;
                    },
                    getSeriesPlaybackPositions: jest.fn().mockResolvedValue([]),
                    savePlaybackPosition: dbSavePlaybackPosition,
                },
            },
        ],
    });
    const positions = TestBed.inject(M3uSeriesPositionsService);
    await positions.load(contentInfo.playlistId, 500);
    const external = TestBed.inject(M3uSeriesExternalPositions);
    external.connect((sessionId) => sessionId === 'vlc-1');
    return {
        receive,
        positions,
        external,
        dbSavePlaybackPosition,
        unsubscribe,
    };
}

describe('M3U external episode positions', () => {
    it('writes the VLC position to the episode playback_positions row', async () => {
        const { receive, dbSavePlaybackPosition, external } = await setup();
        receive({ ...position, sessionId: 'unrelated' });
        receive(position);
        await Promise.resolve();
        expect(dbSavePlaybackPosition).toHaveBeenCalledTimes(1);
        expect(dbSavePlaybackPosition).toHaveBeenLastCalledWith(
            contentInfo.playlistId,
            expect.objectContaining({
                contentType: 'episode',
                seriesXtreamId: 500,
                contentXtreamId: 11,
                positionSeconds: 60,
                durationSeconds: 120,
            })
        );

        receive({ ...position, positionSeconds: 65 });
        external.release();
        expect(dbSavePlaybackPosition).toHaveBeenLastCalledWith(
            contentInfo.playlistId,
            expect.objectContaining({ positionSeconds: 65 })
        );
    });

    it('immediately saves the finished episode as watched', async () => {
        const { receive, positions, external, dbSavePlaybackPosition } =
            await setup();
        receive(position);
        await Promise.resolve();
        await external.complete({
            sessionId: 'vlc-1',
            contentInfo,
            positionSeconds: 115,
            durationSeconds: 120,
        });

        expect(dbSavePlaybackPosition).toHaveBeenLastCalledWith(
            contentInfo.playlistId,
            expect.objectContaining({ positionSeconds: 120, watched: true })
        );
        expect(positions.byEpisodeId().get(11)?.watched).toBe(true);
    });

    it('unsubscribes when the series route is destroyed', async () => {
        const { unsubscribe } = await setup();
        TestBed.resetTestingModule();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
