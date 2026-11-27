import { Playlist } from './playlist.interface';

/**
 * Result of a single playlist inside a startup auto-refresh run.
 *
 * - `updated`: the playlist source was fetched/read and parsed successfully
 * - `failed`: the source could not be reached, read or parsed
 * - `skipped`: the playlist has neither a URL nor a file path, so there is
 *   nothing to refresh from (a configuration problem, not a failure)
 */
export type AutoUpdatePlaylistStatus =
    | 'updated'
    | 'unchanged'
    | 'failed'
    | 'skipped';

export interface AutoUpdatePlaylistOutcome {
    playlistId: string;
    title: string;
    status: AutoUpdatePlaylistStatus;
}

export interface AutoUpdatePlaylistsResult {
    playlists: Playlist[];
    outcomes: AutoUpdatePlaylistOutcome[];
}

export interface AutoUpdatePlaylistsSummary {
    total: number;
    updated: number;
    unchanged: number;
    failed: number;
    skipped: number;
}

export function summarizeAutoUpdateOutcomes(
    outcomes: readonly AutoUpdatePlaylistOutcome[]
): AutoUpdatePlaylistsSummary {
    return {
        total: outcomes.length,
        updated: outcomes.filter((outcome) => outcome.status === 'updated')
            .length,
        unchanged: outcomes.filter((outcome) => outcome.status === 'unchanged')
            .length,
        failed: outcomes.filter((outcome) => outcome.status === 'failed')
            .length,
        skipped: outcomes.filter((outcome) => outcome.status === 'skipped')
            .length,
    };
}
