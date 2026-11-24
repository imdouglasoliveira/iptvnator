import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { selectXtreamStartupRefreshSources } from './xtream-startup-sources';

const xtream: PlaylistMeta = {
    _id: 'source',
    title: 'Sample source',
    autoRefresh: true,
    serverUrl: 'http://example.test',
    username: 'user',
    password: 'pass',
    xtreamContentTypes: ['live'],
    count: 0,
    importDate: '2026-01-01',
};

describe('selectXtreamStartupRefreshSources', () => {
    it('refreshes no Xtream source at startup by default', () => {
        expect(
            selectXtreamStartupRefreshSources([xtream], {
                supportsSqlite: true,
                onUseDisabled: false,
            })
        ).toEqual([]);
    });

    it('restores the startup refresh when the kill switch is set', () => {
        const options = { supportsSqlite: true, onUseDisabled: true };
        expect(selectXtreamStartupRefreshSources([xtream], options)).toEqual([
            xtream,
        ]);
        expect(
            selectXtreamStartupRefreshSources(
                [{ ...xtream, xtreamContentTypes: ['vod'] }],
                options
            )
        ).toEqual([]);
        expect(
            selectXtreamStartupRefreshSources([xtream], {
                ...options,
                supportsSqlite: false,
            })
        ).toEqual([]);
    });
});
