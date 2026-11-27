import { ipcRenderer } from 'electron';
import { M3U_CATALOG_SNAPSHOT_ENABLED } from '@iptvnator/shared/interfaces/ipc-commands';

const snapshotEnabled =
    ipcRenderer.sendSync(M3U_CATALOG_SNAPSHOT_ENABLED) === true;

export const preloadPlaylistReads = {
    dbGetAppPlaylists: () => ipcRenderer.invoke('DB_GET_APP_PLAYLISTS'),
    dbGetAppPlaylistMetas: () =>
        ipcRenderer.invoke('DB_GET_APP_PLAYLIST_METAS'),
    dbGetAppPlaylist: (playlistId: string, _operationId?: string) =>
        ipcRenderer.invoke('DB_GET_APP_PLAYLIST', playlistId),
    dbGetAppPlaylistJson: (playlistId: string, _operationId?: string) =>
        ipcRenderer.invoke('DB_GET_APP_PLAYLIST', playlistId, {
            format: 'json',
        }),
    dbGetAppPlaylistFavoriteChannels: (playlistId: string) =>
        ipcRenderer.invoke('DB_GET_APP_PLAYLIST_FAVORITE_CHANNELS', playlistId),
    ...(snapshotEnabled && {
        dbGetM3uCatalogSnapshot: (playlistId: string): Promise<string | null> =>
            ipcRenderer.invoke('DB_GET_M3U_CATALOG_SNAPSHOT', playlistId),
    }),
};
