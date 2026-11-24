export const XTREAM_LIVE_REFRESH_ON_USE_KILL_SWITCH_ENV =
    'IPTVNATOR_DISABLE_XTREAM_LIVE_REFRESH_ON_USE';

/** Read per call; the renderer cannot see the environment, so the preload passes it in. */
export function isXtreamLiveRefreshOnUseDisabled(
    env: Readonly<Record<string, string | undefined>> | undefined
): boolean {
    return env?.[XTREAM_LIVE_REFRESH_ON_USE_KILL_SWITCH_ENV]?.trim() === '1';
}
