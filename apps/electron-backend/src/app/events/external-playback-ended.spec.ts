import type { PlayerContentInfo } from '@iptvnator/shared/interfaces';
import { createExternalPlaybackEndDetector } from './external-playback-ended';
import { parseVlcRcPlaybackState } from './vlc-rc';

jest.mock('./external-player-runtime', () => ({}));

const episode: PlayerContentInfo = {
    playlistId: 'synthetic-playlist',
    contentXtreamId: 11,
    contentType: 'episode',
    seriesXtreamId: 10,
    m3uSeries: true,
};

describe('external VLC playback ended', () => {
    it.each(['( state stopped ) >', '( stop state: 0 ) >'])(
        'emits once at the last five seconds with status %s',
        (status) => {
            const emit = jest.fn();
            const detect = createExternalPlaybackEndDetector(
                'vlc-1',
                episode,
                emit
            );
            const snapshot = { positionSeconds: 115, durationSeconds: 120 };

            detect('playing', snapshot);
            expect(emit).not.toHaveBeenCalled();
            detect(parseVlcRcPlaybackState(status), null);
            detect(parseVlcRcPlaybackState(status), snapshot);

            expect(emit).toHaveBeenCalledTimes(1);
            expect(emit).toHaveBeenCalledWith({
                sessionId: 'vlc-1',
                contentInfo: episode,
                ...snapshot,
            });
        }
    );

    it('uses the final position when stopped still reports a clock', () => {
        const emit = jest.fn();
        const detect = createExternalPlaybackEndDetector(
            'vlc-1',
            episode,
            emit
        );
        detect('playing', { positionSeconds: 114, durationSeconds: 120 });
        detect('stopped', { positionSeconds: 115, durationSeconds: 120 });
        expect(emit).toHaveBeenCalledTimes(1);
    });

    it('does not emit when the viewer stops midway', () => {
        const emit = jest.fn();
        const detect = createExternalPlaybackEndDetector(
            'vlc-1',
            episode,
            emit
        );
        detect('playing', { positionSeconds: 60, durationSeconds: 120 });
        detect('stopped', null);
        expect(emit).not.toHaveBeenCalled();
    });

    it('uses the latest position if the viewer seeks back before stopping', () => {
        const emit = jest.fn();
        const detect = createExternalPlaybackEndDetector(
            'vlc-1',
            episode,
            emit
        );
        detect('playing', { positionSeconds: 118, durationSeconds: 120 });
        detect('playing', { positionSeconds: 15, durationSeconds: null });
        detect('stopped', { positionSeconds: 0, durationSeconds: 0 });
        expect(emit).not.toHaveBeenCalled();
    });

    it('does not emit for a live channel', () => {
        const emit = jest.fn();
        const detect = createExternalPlaybackEndDetector(
            'vlc-1',
            undefined,
            emit
        );
        detect('playing', { positionSeconds: 120, durationSeconds: 120 });
        detect('stopped', null);
        expect(emit).not.toHaveBeenCalled();
    });

    it('does not emit for an episode with unknown duration', () => {
        const emit = jest.fn();
        const detect = createExternalPlaybackEndDetector(
            'vlc-1',
            episode,
            emit
        );
        detect('playing', { positionSeconds: 120, durationSeconds: null });
        detect('stopped', null);
        expect(emit).not.toHaveBeenCalled();
    });
});
