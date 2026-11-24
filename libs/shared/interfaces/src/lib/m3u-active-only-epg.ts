export const M3U_ACTIVE_ONLY_EPG_KILL_SWITCH_ENV =
    'IPTVNATOR_DISABLE_M3U_ACTIVE_ONLY_EPG';

/** Read per call; the renderer cannot see the environment, so the preload passes it in. */
export function isM3uActiveOnlyEpgDisabled(
    env: Readonly<Record<string, string | undefined>> | undefined
): boolean {
    return env?.[M3U_ACTIVE_ONLY_EPG_KILL_SWITCH_ENV]?.trim() === '1';
}
