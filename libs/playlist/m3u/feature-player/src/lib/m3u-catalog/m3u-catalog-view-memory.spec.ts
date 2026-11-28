import { M3uCatalogViewMemory } from './m3u-catalog-view-memory';

const VIEW = { group: 'Classics', search: 'gri', windowSize: 120, scrollTop: 640 };

describe('M3uCatalogViewMemory', () => {
    it('returns the view left in the same playlist and section', () => {
        const memory = new M3uCatalogViewMemory();
        memory.remember('pl-1', 'movie', VIEW);

        expect(memory.recall('pl-1', 'movie')).toEqual(VIEW);
    });

    it('keeps playlists and sections apart', () => {
        const memory = new M3uCatalogViewMemory();
        memory.remember('pl-1', 'movie', VIEW);

        expect(memory.recall('pl-2', 'movie')).toBeUndefined();
        expect(memory.recall('pl-1', 'episode')).toBeUndefined();
    });

    it('ignores a view with no playlist to key it by', () => {
        const memory = new M3uCatalogViewMemory();
        memory.remember('', 'movie', VIEW);

        expect(memory.recall('', 'movie')).toBeUndefined();
    });
});
