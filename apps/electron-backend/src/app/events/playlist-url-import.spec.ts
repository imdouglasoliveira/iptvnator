import { MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV } from '@iptvnator/shared/interfaces';
import {
    importPlaylistFromUrl,
    isMainPlaylistImportEnabled,
} from './playlist-url-import';

const mockFetchPlaylistFromUrl = jest.fn();
const mockWorkerRequest = jest.fn();
const mockGetDatabase = jest.fn();

jest.mock('./playlist-source', () => ({
    fetchPlaylistFromUrl: (...args: unknown[]) =>
        mockFetchPlaylistFromUrl(...args),
}));
jest.mock('../services/database-worker-client', () => ({
    databaseWorkerClient: {
        request: (...args: unknown[]) => mockWorkerRequest(...args),
    },
}));
jest.mock('../database/connection', () => ({
    getDatabase: () => mockGetDatabase(),
}));

const parsed = {
    _id: 'synthetic-id',
    title: 'Synthetic list',
    filename: 'Synthetic list',
    count: 2,
    url: 'https://example.test/list.m3u',
    epgUrls: ['https://example.test/guide.xml'],
    detectedEpgUrls: ['https://example.test/guide.xml'],
    playlist: { items: [{ name: 'One' }, { name: 'Two' }] },
};

describe('main-process URL playlist import', () => {
    beforeEach(() => {
        Reflect.deleteProperty(process.env, MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV);
        mockFetchPlaylistFromUrl.mockReset().mockResolvedValue(parsed);
        mockWorkerRequest.mockReset().mockResolvedValue({ success: true });
        mockGetDatabase.mockReset().mockResolvedValue(undefined);
    });

    it('persists the whole playlist and returns only the meta', async () => {
        const result = await importPlaylistFromUrl(
            'https://example.test/list.m3u',
            { title: '  Synthetic list  ', userAgent: 'SyntheticAgent/1.0' }
        );

        expect(mockFetchPlaylistFromUrl).toHaveBeenCalledWith(
            'https://example.test/list.m3u',
            'Synthetic list',
            expect.objectContaining({ userAgent: 'SyntheticAgent/1.0' })
        );
        expect(mockGetDatabase).toHaveBeenCalledTimes(1);
        expect(mockWorkerRequest).toHaveBeenCalledWith(
            'DB_UPSERT_APP_PLAYLIST',
            parsed
        );
        expect(result.persisted).toBe(true);
        expect(result.playlist).not.toHaveProperty('playlist');
        expect(result.playlist).toMatchObject({ _id: 'synthetic-id', count: 2 });
    });

    it('applies the EPG opt-out before persisting', async () => {
        await importPlaylistFromUrl('https://example.test/list.m3u', {
            autoImportEpg: false,
        });

        expect(mockWorkerRequest).toHaveBeenCalledWith(
            'DB_UPSERT_APP_PLAYLIST',
            expect.objectContaining({ autoImportEpg: false, epgUrls: [] })
        );
    });

    it('returns the parsed playlist without writing when the kill switch is on', async () => {
        process.env[MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV] = '1';

        const result = await importPlaylistFromUrl(
            'https://example.test/list.m3u'
        );

        expect(isMainPlaylistImportEnabled()).toBe(false);
        expect(mockWorkerRequest).not.toHaveBeenCalled();
        expect(result).toEqual({ persisted: false, playlist: parsed });
    });
});
