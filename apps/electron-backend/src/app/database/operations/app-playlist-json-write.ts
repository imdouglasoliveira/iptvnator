/** Envelope marker for a playlist sent as JSON text instead of an object. */
export const APP_PLAYLIST_JSON_WRITE_FORMAT = 'json';

/**
 * Returns the playlist object from either a JSON text envelope or a plain
 * object. Parse errors never echo the payload, which may hold credentials.
 */
export function decodeAppPlaylistWritePayload(
    payload: unknown
): Record<string, unknown> {
    if (
        !payload ||
        typeof payload !== 'object' ||
        (payload as { format?: unknown }).format !==
            APP_PLAYLIST_JSON_WRITE_FORMAT ||
        typeof (payload as { json?: unknown }).json !== 'string'
    ) {
        return payload as Record<string, unknown>;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse((payload as { json: string }).json);
    } catch {
        throw new Error('Invalid playlist JSON payload');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid playlist JSON payload');
    }
    return parsed as Record<string, unknown>;
}
