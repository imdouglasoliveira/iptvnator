import {
    AppUpdateChannel,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { AppUpdateFeedTarget } from './app-update-feed';
import { ReleaseFetcher } from './app-update-release-catalog';

export interface AppUpdateAppAdapter {
    getVersion(): string;
    isPackaged: boolean;
}

interface AppUpdateWebContents {
    send(channel: string, payload: ElectronBridgeAppUpdateStatus): void;
}

interface AppUpdateWindow {
    isDestroyed(): boolean;
    webContents: AppUpdateWebContents;
}

export interface AppUpdateInfo {
    version: string;
    releaseDate?: string;
    releaseName?: string | null;
    releaseNotes?: string | unknown[] | null;
}

export interface AppUpdateProgressInfo {
    bytesPerSecond?: number;
    percent: number;
    total?: number;
    transferred?: number;
}

export interface AppUpdaterAdapter extends AppUpdateFeedTarget {
    autoDownload: boolean;
    autoInstallOnAppQuit?: boolean;
    checkForUpdates(): Promise<unknown>;
    downloadUpdate(): Promise<string[]>;
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
    on(event: 'checking-for-update', listener: () => void): this;
    on(
        event: 'update-available',
        listener: (info: AppUpdateInfo) => void
    ): this;
    on(
        event: 'update-not-available',
        listener: (info: AppUpdateInfo) => void
    ): this;
    on(
        event: 'download-progress',
        listener: (progress: AppUpdateProgressInfo) => void
    ): this;
    on(
        event: 'update-downloaded',
        listener: (info: AppUpdateInfo) => void
    ): this;
    on(event: 'error', listener: (error: Error) => void): this;
}

export type AppUpdaterAdapterProvider =
    | AppUpdaterAdapter
    | (() => AppUpdaterAdapter);

export interface AppUpdateServiceOptions {
    app: AppUpdateAppAdapter;
    appVersion?: string;
    updater: AppUpdaterAdapterProvider;
    getMainWindow: () => AppUpdateWindow | null | undefined;
    platform?: NodeJS.Platform;
    processEnv?: NodeJS.ProcessEnv;
    releaseFetcher?: ReleaseFetcher;
    /** Persisted update channel at startup; `setChannel` follows later saves. */
    channel?: AppUpdateChannel;
    /** Bypasses the unsaved-settings guard for the updater close before macOS `before-quit`. */
    prepareQuit?: () => void;
    /** Restores the close guard if `quitAndInstall()` throws synchronously. */
    cancelPreparedQuit?: () => void;
}
