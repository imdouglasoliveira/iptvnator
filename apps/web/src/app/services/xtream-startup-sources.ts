import {
    isXtreamAccountPlaylist,
    normalizeXtreamContentTypes,
    type PlaylistMeta,
} from '@iptvnator/shared/interfaces';

/** Xtream sources to refresh at startup: none, unless the on-use kill switch restores the old trigger. */
export function selectXtreamStartupRefreshSources(
    optedIn: readonly PlaylistMeta[],
    options: { supportsSqlite: boolean; onUseDisabled: boolean }
): PlaylistMeta[] {
    if (!options.onUseDisabled || !options.supportsSqlite) return [];
    return optedIn.filter(
        (playlist) =>
            !playlist.portalUrl &&
            isXtreamAccountPlaylist(playlist) &&
            normalizeXtreamContentTypes(playlist.xtreamContentTypes).includes(
                'live'
            )
    );
}
