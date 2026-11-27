import { M3uCatalogSectionFlags } from './m3u-catalog-source';

export const M3U_CATALOG_SECTIONS_STORAGE_KEY = 'm3u-catalog-sections-v1';

type RememberedSections = Record<string, M3uCatalogSectionFlags>;

function storage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

function isFlags(value: unknown): value is M3uCatalogSectionFlags {
    const flags = value as Partial<M3uCatalogSectionFlags> | null;
    return (
        typeof flags === 'object' &&
        flags !== null &&
        typeof flags.movies === 'boolean' &&
        typeof flags.series === 'boolean'
    );
}

function readAll(): RememberedSections {
    try {
        const raw = storage()?.getItem(M3U_CATALOG_SECTIONS_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (typeof parsed !== 'object' || parsed === null) return {};
        const all: RememberedSections = {};
        for (const id of Object.keys(parsed)) {
            const flags = (parsed as Record<string, unknown>)[id];
            if (isFlags(flags)) {
                all[id] = { movies: flags.movies, series: flags.series };
            }
        }
        return all;
    } catch {
        return {};
    }
}

/**
 * The sections a playlist held the last time it was indexed, or null when
 * nothing was remembered or the storage cannot be read. Read by the rail
 * before any index exists, so the sections show from the first frame.
 */
export function readRememberedM3uSections(
    playlistId: string
): M3uCatalogSectionFlags | null {
    return readAll()[playlistId] ?? null;
}

/** Stores a playlist's sections; does nothing when they have not changed. */
export function rememberM3uSections(
    playlistId: string,
    sections: M3uCatalogSectionFlags
): void {
    const all = readAll();
    const known = all[playlistId];
    if (
        known &&
        known.movies === sections.movies &&
        known.series === sections.series
    ) {
        return;
    }
    all[playlistId] = { movies: sections.movies, series: sections.series };
    try {
        storage()?.setItem(
            M3U_CATALOG_SECTIONS_STORAGE_KEY,
            JSON.stringify(all)
        );
    } catch {
        // Storage unavailable or full: the sections show once the index builds.
    }
}
