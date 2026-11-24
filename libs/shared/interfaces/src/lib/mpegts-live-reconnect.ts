export const MPEGTS_LIVE_RECONNECT_KILL_SWITCH_ENV =
    'IPTVNATOR_DISABLE_MPEGTS_LIVE_RECONNECT';

/** Read per call; the renderer cannot see the environment, so the preload passes it in. */
export function isMpegTsLiveReconnectDisabled(
    env: Readonly<Record<string, string | undefined>> | undefined
): boolean {
    return env?.[MPEGTS_LIVE_RECONNECT_KILL_SWITCH_ENV]?.trim() === '1';
}
