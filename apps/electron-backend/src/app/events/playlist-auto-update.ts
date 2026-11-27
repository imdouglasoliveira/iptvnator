import type {
    AutoUpdatePlaylistStatus,
    AutoUpdatePlaylistsResult,
    Playlist,
} from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import {
    isRefreshDeferred,
    prepareConditionalRefresh,
    readCurrentM3uRevisionCounter,
    recordConditionalRefreshFailure,
    recordConditionalRefreshSuccess,
} from './m3u-refresh-state';
import {
    fetchPlaylistFromFile,
    fetchPlaylistFromUrlConditional,
    preserveAutoUpdatedPlaylistFields,
    type PlaylistFetchOptions,
} from './playlist-source';

export const AUTO_UPDATE_CONCURRENCY = 3;

type RefreshPlaylistOutcome =
    | { status: 'updated'; playlist: Playlist }
    | { status: 'unchanged' }
    | { status: 'skipped' };

async function refreshPlaylist(
    playlist: Playlist,
    options: PlaylistFetchOptions
): Promise<RefreshPlaylistOutcome> {
    if (playlist.importDate && playlist.url) {
        const prepared = await prepareConditionalRefresh(
            playlist._id,
            playlist.itemsRevision
        );
        if (prepared.enabled && isRefreshDeferred(prepared.state)) {
            return { status: 'unchanged' };
        }
        console.log(
            `Updating playlist "${playlist.title}" from URL: ${redactSensitiveData(playlist.url)}`
        );
        try {
            const fetched = await fetchPlaylistFromUrlConditional(
                playlist.url,
                playlist.title,
                {
                    ...options,
                    userAgent: playlist.userAgent,
                    refreshState: prepared.state,
                    forceFullDownload: prepared.forceFullDownload,
                }
            );
            if (fetched.status === 'unchanged') {
                if (prepared.enabled) {
                    await recordConditionalRefreshSuccess(
                        playlist._id,
                        prepared.state,
                        fetched,
                        playlist.itemsRevision
                    );
                }
                console.log(`Playlist "${playlist.title}" unchanged`);
                return { status: 'unchanged' };
            }
            if (prepared.enabled) {
                const counter = await readCurrentM3uRevisionCounter();
                const nextRevision =
                    counter !== null
                        ? counter + 1
                        : playlist.itemsRevision !== undefined
                          ? playlist.itemsRevision + 1
                          : undefined;
                await recordConditionalRefreshSuccess(
                    playlist._id,
                    prepared.state,
                    fetched,
                    nextRevision
                );
            }
            console.log(`Successfully updated playlist "${playlist.title}"`);
            return {
                status: 'updated',
                playlist: preserveAutoUpdatedPlaylistFields(
                    fetched.playlist,
                    playlist
                ),
            };
        } catch (error) {
            if (prepared.enabled) {
                await recordConditionalRefreshFailure(
                    playlist._id,
                    prepared.state,
                    playlist.itemsRevision
                );
            }
            throw error;
        }
    }
    if (playlist.filePath) {
        console.log(
            `Updating playlist "${playlist.title}" from file: ${playlist.filePath}`
        );
        const playlistObject = await fetchPlaylistFromFile(
            playlist.filePath,
            playlist.title
        );
        console.log(`Successfully updated playlist "${playlist.title}"`);
        return {
            status: 'updated',
            playlist: preserveAutoUpdatedPlaylistFields(
                playlistObject,
                playlist
            ),
        };
    }

    console.warn(
        `Skipping playlist "${playlist.title}": no URL or file path found`
    );
    return { status: 'skipped' };
}

export async function autoUpdatePlaylists(
    playlists: readonly Playlist[],
    options: PlaylistFetchOptions = {}
): Promise<AutoUpdatePlaylistsResult> {
    const results: (Playlist | null)[] = new Array(playlists.length).fill(null);
    const statuses: (AutoUpdatePlaylistStatus | undefined)[] = new Array(
        playlists.length
    );
    let nextIndex = 0;

    const refreshNextPlaylist = async (): Promise<void> => {
        for (
            let index = nextIndex++;
            index < playlists.length;
            index = nextIndex++
        ) {
            const playlist = playlists[index];

            try {
                const outcome = await refreshPlaylist(playlist, options);
                if (outcome.status === 'updated') {
                    results[index] = outcome.playlist;
                }
                statuses[index] = outcome.status;
            } catch (error) {
                console.error(
                    `Failed to update playlist "${playlist.title}":`,
                    redactSensitiveData(error)
                );
                statuses[index] = 'failed';
            }
        }
    };

    await Promise.all(
        Array.from(
            { length: Math.min(AUTO_UPDATE_CONCURRENCY, playlists.length) },
            refreshNextPlaylist
        )
    );

    return {
        playlists: results.filter(
            (playlist): playlist is Playlist => playlist !== null
        ),
        outcomes: playlists.map((playlist, index) => ({
            playlistId: playlist._id,
            title: playlist.title,
            status: statuses[index] ?? 'failed',
        })),
    };
}
