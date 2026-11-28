import { hashM3uId } from './m3u-stable-id.util';

const XTREAM_MOVIE_PATH = /\/movie\/[^/]+\/[^/]+\/(\d+)(?:\.[A-Za-z0-9]+)?$/;

/** Key of a favorite series in `playlists.favorites`, next to the movie URLs. */
export const M3U_SERIES_FAVORITE_PREFIX = 'm3u-series:';

export function m3uSeriesFavoriteKey(stableId: number): string {
    return `${M3U_SERIES_FAVORITE_PREFIX}${stableId}`;
}

export function isM3uSeriesFavoriteKey(value: string): boolean {
    return value.startsWith(M3U_SERIES_FAVORITE_PREFIX);
}

function withoutQueryAndFragment(url: string): string {
    const cut = url.search(/[?#]/);
    return cut < 0 ? url : url.slice(0, cut);
}

/**
 * Id of a movie entry that survives a rotating token: the stream id of an
 * Xtream-style `/movie/<user>/<pass>/<id>.<ext>` path, else the 48-bit hash
 * of the URL without query and fragment.
 */
export function m3uMovieStableId(url: string): number {
    const bare = withoutQueryAndFragment(String(url ?? '').trim());
    const streamId = XTREAM_MOVIE_PATH.exec(bare)?.[1];
    const parsed = streamId ? Number(streamId) : NaN;
    return Number.isSafeInteger(parsed) && parsed > 0
        ? parsed
        : hashM3uId(bare);
}
