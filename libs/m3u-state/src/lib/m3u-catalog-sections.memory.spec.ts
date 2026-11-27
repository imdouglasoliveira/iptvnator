import {
    M3U_CATALOG_SECTIONS_STORAGE_KEY,
    readRememberedM3uSections,
    rememberM3uSections,
} from './m3u-catalog-sections.memory';

describe('m3u catalog sections memory', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => jest.restoreAllMocks());

    it('reads what an earlier session stored, before any index exists', () => {
        localStorage.setItem(
            M3U_CATALOG_SECTIONS_STORAGE_KEY,
            JSON.stringify({ 'pl-a': { movies: true, series: false } })
        );

        expect(readRememberedM3uSections('pl-a')).toEqual({
            movies: true,
            series: false,
        });
        expect(readRememberedM3uSections('pl-b')).toBeNull();
    });

    it('keeps each playlist apart', () => {
        rememberM3uSections('pl-a', { movies: true, series: false });
        rememberM3uSections('pl-b', { movies: false, series: true });

        expect(readRememberedM3uSections('pl-a')?.movies).toBe(true);
        expect(readRememberedM3uSections('pl-b')?.series).toBe(true);
    });

    it('stores a live-only playlist as both sections off', () => {
        rememberM3uSections('pl-a', { movies: false, series: false });

        expect(readRememberedM3uSections('pl-a')).toEqual({
            movies: false,
            series: false,
        });
    });

    it('writes only when the sections change', () => {
        const setItem = jest.spyOn(Storage.prototype, 'setItem');

        rememberM3uSections('pl-a', { movies: true, series: true });
        rememberM3uSections('pl-a', { movies: true, series: true });
        expect(setItem).toHaveBeenCalledTimes(1);

        rememberM3uSections('pl-a', { movies: true, series: false });
        expect(setItem).toHaveBeenCalledTimes(2);
    });

    it('ignores stored data that is not a section map', () => {
        localStorage.setItem(M3U_CATALOG_SECTIONS_STORAGE_KEY, '{oops');
        expect(readRememberedM3uSections('pl-a')).toBeNull();

        localStorage.setItem(
            M3U_CATALOG_SECTIONS_STORAGE_KEY,
            JSON.stringify({ 'pl-a': { movies: 'yes' } })
        );
        expect(readRememberedM3uSections('pl-a')).toBeNull();
    });

    it('does not break when the storage is unavailable', () => {
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied');
        });

        expect(readRememberedM3uSections('pl-a')).toBeNull();
        expect(() =>
            rememberM3uSections('pl-a', { movies: true, series: true })
        ).not.toThrow();
    });
});
