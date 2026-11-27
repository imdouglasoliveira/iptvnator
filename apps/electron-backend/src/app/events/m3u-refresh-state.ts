import { M3U_CONDITIONAL_REFRESH_KILL_SWITCH } from '@iptvnator/shared/interfaces';
import { databaseWorkerClient } from '../services/database-worker-client';

export const M3U_REFRESH_STATE_PREFIX = 'm3u-refresh-state:';
export const FULL_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const INITIAL_FAILURE_BACKOFF_MS = 180 * 1000;
export const MAX_FAILURE_BACKOFF_MS = 24 * 60 * 60 * 1000;

export interface M3uRefreshState {
    etag?: string;
    lastModified?: string;
    bodySha256: string;
    itemsRevision: number;
    checkedAt: string;
    lastFullCheckAt?: string;
    nextCheckAt: string;
    failures: number;
}

export interface M3uRefreshStateStore {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
}

export interface ConditionalRefreshOutcomeMeta {
    etag?: string;
    lastModified?: string;
    bodySha256: string;
    fromNotModified?: boolean;
}

export interface PreparedConditionalRefresh {
    enabled: boolean;
    state: M3uRefreshState | null;
    forceFullDownload: boolean;
}

export interface RefreshStateOptions {
    store?: M3uRefreshStateStore;
    now?: number;
    env?: Readonly<Record<string, string | undefined>>;
}

const defaultStore: M3uRefreshStateStore = {
    get: async (key: string) => {
        try {
            return await databaseWorkerClient.request<string | null>(
                'DB_GET_APP_STATE',
                { key }
            );
        } catch {
            return null;
        }
    },
    set: async (key: string, value: string) => {
        try {
            await databaseWorkerClient.request('DB_SET_APP_STATE', {
                key,
                value,
            });
        } catch {
            return;
        }
    },
};

let conditionalRefreshSettingEnabled = true;

export function setConditionalRefreshSettingEnabled(enabled: boolean): void {
    conditionalRefreshSettingEnabled = enabled;
}

export function isConditionalRefreshEnabled(
    env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
    return (
        conditionalRefreshSettingEnabled &&
        env[M3U_CONDITIONAL_REFRESH_KILL_SWITCH] !== '1'
    );
}

export function buildM3uRefreshStateKey(playlistId: string): string {
    return `${M3U_REFRESH_STATE_PREFIX}${playlistId}`;
}

export function parseM3uRefreshState(raw: string | null): M3uRefreshState | null {
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as Partial<M3uRefreshState>;
        if (
            typeof parsed !== 'object' ||
            parsed === null ||
            typeof parsed.bodySha256 !== 'string' ||
            typeof parsed.itemsRevision !== 'number' ||
            typeof parsed.checkedAt !== 'string' ||
            typeof parsed.nextCheckAt !== 'string' ||
            typeof parsed.failures !== 'number'
        ) {
            return null;
        }
        return {
            ...(typeof parsed.etag === 'string' && parsed.etag
                ? { etag: parsed.etag }
                : {}),
            ...(typeof parsed.lastModified === 'string' && parsed.lastModified
                ? { lastModified: parsed.lastModified }
                : {}),
            bodySha256: parsed.bodySha256,
            itemsRevision: parsed.itemsRevision,
            checkedAt: parsed.checkedAt,
            ...(typeof parsed.lastFullCheckAt === 'string' &&
            parsed.lastFullCheckAt
                ? { lastFullCheckAt: parsed.lastFullCheckAt }
                : {}),
            nextCheckAt: parsed.nextCheckAt,
            failures: parsed.failures,
        };
    } catch {
        return null;
    }
}

export function computeFailureBackoffMs(failures: number): number {
    const count = Math.max(1, Math.floor(failures));
    const delay = INITIAL_FAILURE_BACKOFF_MS * Math.pow(2, count - 1);
    return Math.min(delay, MAX_FAILURE_BACKOFF_MS);
}

export function isFullDownloadDue(
    state: M3uRefreshState | null,
    now = Date.now()
): boolean {
    if (!state) {
        return true;
    }
    const anchor = Date.parse(state.lastFullCheckAt ?? state.checkedAt);
    if (!Number.isFinite(anchor)) {
        return true;
    }
    return now - anchor >= FULL_REFRESH_INTERVAL_MS;
}

export function isRefreshDeferred(
    state: M3uRefreshState | null,
    now = Date.now()
): boolean {
    if (!state || state.failures <= 0) {
        return false;
    }
    const nextCheck = Date.parse(state.nextCheckAt);
    return Number.isFinite(nextCheck) && nextCheck > now;
}

export async function readM3uRefreshState(
    playlistId: string,
    store: M3uRefreshStateStore = defaultStore
): Promise<M3uRefreshState | null> {
    if (!playlistId) {
        return null;
    }
    const raw = await store.get(buildM3uRefreshStateKey(playlistId));
    return parseM3uRefreshState(raw);
}

export async function writeM3uRefreshState(
    playlistId: string,
    state: M3uRefreshState,
    store: M3uRefreshStateStore = defaultStore
): Promise<void> {
    if (!playlistId) {
        return;
    }
    await store.set(buildM3uRefreshStateKey(playlistId), JSON.stringify(state));
}

export async function readCurrentM3uRevisionCounter(
    store: M3uRefreshStateStore = defaultStore
): Promise<number | null> {
    const raw = await store.get('m3u-items-revision');
    if (!raw) {
        return null;
    }
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function prepareConditionalRefresh(
    playlistId: string,
    currentItemsRevision?: number,
    options: RefreshStateOptions = {}
): Promise<PreparedConditionalRefresh> {
    const enabled = isConditionalRefreshEnabled(options.env);
    if (!enabled) {
        return { enabled: false, state: null, forceFullDownload: true };
    }
    const stored = await readM3uRefreshState(playlistId, options.store);
    if (!stored) {
        return { enabled: true, state: null, forceFullDownload: false };
    }
    if (
        currentItemsRevision !== undefined &&
        stored.itemsRevision !== currentItemsRevision
    ) {
        return { enabled: true, state: null, forceFullDownload: false };
    }
    const now = options.now ?? Date.now();
    return {
        enabled: true,
        state: stored,
        forceFullDownload: isFullDownloadDue(stored, now),
    };
}

export async function recordConditionalRefreshSuccess(
    playlistId: string,
    previousState: M3uRefreshState | null,
    meta: ConditionalRefreshOutcomeMeta,
    itemsRevision?: number,
    options: RefreshStateOptions = {}
): Promise<M3uRefreshState> {
    const now = options.now ?? Date.now();
    const nowIso = new Date(now).toISOString();
    const etag = meta.etag ?? previousState?.etag;
    const lastModified = meta.lastModified ?? previousState?.lastModified;
    const lastFullCheckAt = meta.fromNotModified
        ? (previousState?.lastFullCheckAt ?? previousState?.checkedAt ?? nowIso)
        : nowIso;
    const nextState: M3uRefreshState = {
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {}),
        bodySha256: meta.bodySha256 || previousState?.bodySha256 || '',
        itemsRevision: itemsRevision ?? previousState?.itemsRevision ?? 0,
        checkedAt: nowIso,
        lastFullCheckAt,
        nextCheckAt: nowIso,
        failures: 0,
    };
    await writeM3uRefreshState(playlistId, nextState, options.store);
    return nextState;
}

export async function recordConditionalRefreshFailure(
    playlistId: string,
    previousState: M3uRefreshState | null,
    currentItemsRevision?: number,
    options: RefreshStateOptions = {}
): Promise<M3uRefreshState> {
    const now = options.now ?? Date.now();
    const nowIso = new Date(now).toISOString();
    const failures = (previousState?.failures ?? 0) + 1;
    const nextCheckAt = new Date(
        now + computeFailureBackoffMs(failures)
    ).toISOString();
    const nextState: M3uRefreshState = {
        ...(previousState?.etag ? { etag: previousState.etag } : {}),
        ...(previousState?.lastModified
            ? { lastModified: previousState.lastModified }
            : {}),
        bodySha256: previousState?.bodySha256 ?? '',
        itemsRevision: currentItemsRevision ?? previousState?.itemsRevision ?? 0,
        checkedAt: nowIso,
        ...(previousState?.lastFullCheckAt
            ? { lastFullCheckAt: previousState.lastFullCheckAt }
            : {}),
        nextCheckAt,
        failures,
    };
    await writeM3uRefreshState(playlistId, nextState, options.store);
    return nextState;
}

export async function finalizeConditionalRefreshSuccess(
    playlistId: string,
    prepared: PreparedConditionalRefresh | null,
    meta: ConditionalRefreshOutcomeMeta & { unchanged: boolean },
    currentItemsRevision?: number,
    options: RefreshStateOptions = {}
): Promise<void> {
    if (!prepared?.enabled) {
        return;
    }
    let targetRevision = currentItemsRevision;
    if (!meta.unchanged) {
        const counter = await readCurrentM3uRevisionCounter(options.store);
        targetRevision =
            counter !== null
                ? counter + 1
                : currentItemsRevision !== undefined
                  ? currentItemsRevision + 1
                  : undefined;
    }
    await recordConditionalRefreshSuccess(
        playlistId,
        prepared.state,
        meta,
        targetRevision,
        options
    );
}
