import {
    MPEGTS_LIVE_RECONNECT_KILL_SWITCH_ENV,
    isMpegTsLiveReconnectDisabled,
} from './mpegts-live-reconnect';

describe('isMpegTsLiveReconnectDisabled', () => {
    it('is disabled only by the exact value 1', () => {
        const key = MPEGTS_LIVE_RECONNECT_KILL_SWITCH_ENV;
        expect(key).toBe('IPTVNATOR_DISABLE_MPEGTS_LIVE_RECONNECT');
        expect(isMpegTsLiveReconnectDisabled({ [key]: '1' })).toBe(true);
        expect(isMpegTsLiveReconnectDisabled({ [key]: '0' })).toBe(false);
        expect(isMpegTsLiveReconnectDisabled({ [key]: 'true' })).toBe(false);
        expect(isMpegTsLiveReconnectDisabled({})).toBe(false);
        expect(isMpegTsLiveReconnectDisabled(undefined)).toBe(false);
    });
});
