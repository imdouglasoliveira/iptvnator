import {
    XTREAM_LIVE_REFRESH_ON_USE_KILL_SWITCH_ENV,
    isXtreamLiveRefreshOnUseDisabled,
} from './xtream-live-refresh-on-use';

describe('isXtreamLiveRefreshOnUseDisabled', () => {
    it('is disabled only by the exact value 1', () => {
        const key = XTREAM_LIVE_REFRESH_ON_USE_KILL_SWITCH_ENV;
        expect(key).toBe('IPTVNATOR_DISABLE_XTREAM_LIVE_REFRESH_ON_USE');
        expect(isXtreamLiveRefreshOnUseDisabled({ [key]: '1' })).toBe(true);
        expect(isXtreamLiveRefreshOnUseDisabled({ [key]: '0' })).toBe(false);
        expect(isXtreamLiveRefreshOnUseDisabled({ [key]: 'true' })).toBe(false);
        expect(isXtreamLiveRefreshOnUseDisabled({})).toBe(false);
        expect(isXtreamLiveRefreshOnUseDisabled(undefined)).toBe(false);
    });
});
