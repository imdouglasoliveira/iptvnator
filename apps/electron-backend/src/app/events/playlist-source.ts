import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    createPlaylistObject,
    getFilenameFromUrl,
} from '@iptvnator/shared/m3u-utils';
import { parse } from 'iptv-playlist-parser';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createPlaylistAgentFactory } from '../util/secure-https';
import {
    createInvalidTlsCertificateError,
    getHostnameFromErrorUrl,
    isInvalidTlsCertificateError,
} from '../util/security-errors';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import type { M3uRefreshState } from './m3u-refresh-state';
import type { M3uImportPerformanceCapture } from './playlist-import-performance';
import { M3U_IMPORT_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';

export interface PlaylistFetchOptions {
    userAgent?: string;
    performanceCapture?: M3uImportPerformanceCapture | null;
    trustedInsecureTlsHosts?: readonly string[];
}

export interface ConditionalPlaylistFetchOptions extends PlaylistFetchOptions {
    refreshState?: M3uRefreshState | null;
    forceFullDownload?: boolean;
    signal?: AbortSignal;
}

export type ConditionalPlaylistFetchResult =
    | {
          status: 'unchanged';
          etag?: string;
          lastModified?: string;
          bodySha256: string;
          fromNotModified: boolean;
      }
    | {
          status: 'updated';
          playlist: Playlist;
          etag?: string;
          lastModified?: string;
          bodySha256: string;
          fromNotModified: false;
      };

/**
 * Idle timeout for every playlist download hop. Without it a host that accepts
 * the connection and then goes silent keeps the request pending forever, which
 * stalled the unattended startup auto-update indefinitely (issue #931).
 * Some Xtream panels build the M3U on demand and send the first byte only
 * after about a minute, so the budget leaves room for that wait.
 * Mirrored by the playlist refresh worker and the web backend.
 */
export const PLAYLIST_FETCH_TIMEOUT_MS = 120000;

function countPlaylistItems(value: unknown): number | undefined {
    try {
        if (typeof value !== 'object' || value === null) {
            return undefined;
        }
        const items = Reflect.get(value, 'items');
        return Array.isArray(items) ? items.length : undefined;
    } catch {
        return undefined;
    }
}

function countNormalizedPlaylistItems(value: unknown): number | undefined {
    try {
        if (typeof value !== 'object' || value === null) {
            return undefined;
        }
        return countPlaylistItems(Reflect.get(value, 'playlist'));
    } catch {
        return undefined;
    }
}

function readResponseContentLength(response: unknown): number | undefined {
    try {
        if (typeof response !== 'object' || response === null) {
            return undefined;
        }
        const headers = Reflect.get(response, 'headers');
        if (typeof headers !== 'object' || headers === null) {
            return undefined;
        }
        const directValue = Reflect.get(headers, 'content-length');
        const getHeader = Reflect.get(headers, 'get');
        const value =
            directValue ??
            (typeof getHeader === 'function'
                ? Reflect.apply(getHeader, headers, ['content-length'])
                : undefined);
        const numericValue =
            typeof value === 'number'
                ? value
                : typeof value === 'string' && value.trim().length > 0
                  ? Number(value)
                  : Number.NaN;
        return Number.isSafeInteger(numericValue) && numericValue >= 0
            ? numericValue
            : undefined;
    } catch {
        return undefined;
    }
}

export function hashPlaylistBody(body: string): string {
    return createHash('sha256').update(body, 'utf8').digest('hex');
}

function readResponseHeader(
    response: unknown,
    name: string
): string | undefined {
    try {
        if (typeof response !== 'object' || response === null) {
            return undefined;
        }
        const headers = Reflect.get(response, 'headers');
        if (typeof headers !== 'object' || headers === null) {
            return undefined;
        }
        const directValue = Reflect.get(headers, name);
        const getHeader = Reflect.get(headers, 'get');
        const value =
            directValue ??
            (typeof getHeader === 'function'
                ? Reflect.apply(getHeader, headers, [name])
                : undefined);
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
        return undefined;
    } catch {
        return undefined;
    }
}

export async function fetchPlaylistFromUrlConditional(
    url: string,
    title?: string,
    options: ConditionalPlaylistFetchOptions = {}
): Promise<ConditionalPlaylistFetchResult> {
    const performanceCapture = options.performanceCapture;
    const userAgent = options.userAgent?.trim() || undefined;
    const refreshState = options.refreshState ?? null;
    const useValidators = Boolean(refreshState && !options.forceFullDownload);
    const headers: Record<string, string> = {};
    if (userAgent) {
        headers['User-Agent'] = userAgent;
    }
    if (useValidators && refreshState?.etag) {
        headers['If-None-Match'] = refreshState.etag;
    }
    if (useValidators && refreshState?.lastModified) {
        headers['If-Modified-Since'] = refreshState.lastModified;
    }
    const request = () =>
        requestWithValidatedRedirects<string>(
            url,
            {
                agentFactory: createPlaylistAgentFactory({
                    trustedInsecureTlsHosts: options.trustedInsecureTlsHosts,
                }),
                method: 'GET',
                ...(Object.keys(headers).length > 0 ? { headers } : {}),
                ...(options.signal ? { signal: options.signal } : {}),
                ...(useValidators ? { acceptNotModified: true } : {}),
                timeout: PLAYLIST_FETCH_TIMEOUT_MS,
            },
            { allowPrivateNetworks: true }
        );
    let result;
    try {
        result = performanceCapture
            ? await performanceCapture.measureAsync(
                  M3U_IMPORT_PERFORMANCE_PHASE.DATA_ACQUIRE,
                  request,
                  (response) => ({
                      byteCount: readResponseContentLength(response),
                  })
              )
            : await request();
    } catch (error) {
        if (isInvalidTlsCertificateError(error)) {
            throw createInvalidTlsCertificateError(
                getHostnameFromErrorUrl(error, url)
            );
        }
        throw error;
    }

    const etag = readResponseHeader(result, 'etag') ?? refreshState?.etag;
    const lastModified =
        readResponseHeader(result, 'last-modified') ??
        refreshState?.lastModified;

    if (result.status === 304) {
        return {
            status: 'unchanged',
            etag,
            lastModified,
            bodySha256: refreshState?.bodySha256 ?? '',
            fromNotModified: true,
        };
    }

    const body =
        typeof result.data === 'string'
            ? result.data
            : String(result.data ?? '');
    const bodySha256 = hashPlaylistBody(body);

    if (refreshState?.bodySha256 && refreshState.bodySha256 === bodySha256) {
        return {
            status: 'unchanged',
            etag,
            lastModified,
            bodySha256,
            fromNotModified: false,
        };
    }

    const parsedPlaylist = performanceCapture
        ? performanceCapture.measure(
              M3U_IMPORT_PERFORMANCE_PHASE.PARSE_M3U,
              () => parse(body),
              (parsed) => ({ itemCount: countPlaylistItems(parsed) })
          )
        : parse(body);
    const normalize = (): Playlist => {
        const extractedName =
            url && url.length > 1 ? getFilenameFromUrl(url) : '';
        const playlistName =
            !extractedName || extractedName === 'Untitled playlist'
                ? 'Imported from URL'
                : extractedName;

        const playlist = createPlaylistObject(
            title ?? playlistName,
            parsedPlaylist,
            url,
            'URL'
        );
        if (userAgent) {
            playlist.userAgent = userAgent;
        }
        return playlist;
    };

    const playlist = performanceCapture
        ? performanceCapture.measure(
              M3U_IMPORT_PERFORMANCE_PHASE.NORMALIZE,
              normalize,
              (normalized) => ({
                  itemCount: countNormalizedPlaylistItems(normalized),
              })
          )
        : normalize();

    return {
        status: 'updated',
        playlist,
        etag,
        lastModified,
        bodySha256,
        fromNotModified: false,
    };
}

export async function fetchPlaylistFromUrl(
    url: string,
    title?: string,
    options: PlaylistFetchOptions = {}
): Promise<Playlist> {
    const fetched = await fetchPlaylistFromUrlConditional(url, title, options);
    if (fetched.status !== 'updated') {
        throw new Error('Unexpected unchanged result on unconditional fetch');
    }
    return fetched.playlist;
}

export async function fetchPlaylistFromFile(
    filePath: string,
    title: string
): Promise<Playlist> {
    const fileContent = await readFile(filePath, 'utf-8');
    return createPlaylistObject(title, parse(fileContent), filePath, 'FILE');
}

export function derivePlaylistTitleFromFilePath(filePath: string): string {
    const filename = basename(filePath);
    return filename.replace(/\.(m3u8?|pls|txt)$/i, '') || 'from file';
}

export function preserveAutoUpdatedPlaylistFields(
    playlistObject: Playlist,
    playlist: Playlist
): Playlist {
    return {
        ...playlistObject,
        _id: playlist._id,
        autoRefresh: playlist.autoRefresh,
        favorites: playlist.favorites || [],
        userAgent: playlist.userAgent,
    };
}
