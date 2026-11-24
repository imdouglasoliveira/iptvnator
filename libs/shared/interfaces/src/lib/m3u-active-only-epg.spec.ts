import {
    isM3uActiveOnlyEpgDisabled,
    M3U_ACTIVE_ONLY_EPG_KILL_SWITCH_ENV,
} from './m3u-active-only-epg';

describe('isM3uActiveOnlyEpgDisabled', () => {
    it('is enabled by default and for missing env', () => {
        expect(isM3uActiveOnlyEpgDisabled({})).toBe(false);
        expect(isM3uActiveOnlyEpgDisabled(undefined)).toBe(false);
    });

    it('is disabled only when the variable is "1"', () => {
        const key = M3U_ACTIVE_ONLY_EPG_KILL_SWITCH_ENV;
        expect(isM3uActiveOnlyEpgDisabled({ [key]: '1' })).toBe(true);
        expect(isM3uActiveOnlyEpgDisabled({ [key]: ' 1 ' })).toBe(true);
        expect(isM3uActiveOnlyEpgDisabled({ [key]: '0' })).toBe(false);
        expect(isM3uActiveOnlyEpgDisabled({ [key]: 'true' })).toBe(false);
    });

    it('reads the environment on every call', () => {
        const env: Record<string, string | undefined> = {};
        expect(isM3uActiveOnlyEpgDisabled(env)).toBe(false);
        env[M3U_ACTIVE_ONLY_EPG_KILL_SWITCH_ENV] = '1';
        expect(isM3uActiveOnlyEpgDisabled(env)).toBe(true);
    });
});
