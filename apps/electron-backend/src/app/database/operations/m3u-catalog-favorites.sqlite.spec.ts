import {
    catalogFavoritesPrelude,
    runCatalogFavoritesScript,
} from './testing/m3u-catalog-favorites-run';

interface Row {
    type: string;
    stableId: number;
    contentId: number | null;
    title: string;
    poster: string | null;
}

interface Output {
    movieAdded: { favoriteId: number | null };
    movieRows: Row[];
    movieJson: string[];
    movieAgainId: number | null;
    movieAgainRows: Row[];
    movieAgainJson: string[];
    rotatedRows: Row[];
    rotatedJson: string[];
    seriesAddedRows: Row[];
    seriesAddedJson: string[];
    seriesIds: number[];
    movieIds: number[];
    seriesAgainRows: Row[];
    seriesAgainJson: string[];
    seriesRemovedRows: Row[];
    seriesRemovedJson: string[];
    movieRemovedRows: Row[];
    movieRemovedJson: string[];
    removeMissing: { favoriteId: number | null };
    untouchedPayload: boolean;
    revisionKept: boolean;
    xtreamRejected: string;
    invalidRejected: string[];
    copy: {
        first: { copied: number; skipped: boolean };
        rowsAfterFirst: Row[];
        jsonBefore: string[];
        jsonAfterFirst: string[];
        second: { copied: number; skipped: boolean };
        rowsAfterSecond: Row[];
        jsonAfterSecond: string[];
        afterRowRemoved: Row[];
        marks: number;
    };
    copyAll: { total: number; again: number; otherRows: number };
    withoutPayload: { skipped: boolean; marks: number };
    deleted: { rows: number; marks: number };
}

const SCRIPT = `
    ${catalogFavoritesPrelude()}
    const sqlite = openDatabase();
    hooks.createTables(sqlite);
    hooks.runMigrations(sqlite);
    const db = drizzle(sqlite, { schema });
    const live = base + 'live/u/p/9.ts';
    insertM3u(sqlite, 'm3u', [live]);
    sqlite.exec("INSERT INTO playlists (id, name, type) VALUES ('xtream', 'Panel', 'xtream')");
    const payloadOf = (id) => sqlite.prepare('SELECT payload FROM playlists WHERE id = ?').get(id).payload;
    const revisionOf = (id) => sqlite.prepare('SELECT items_revision AS r FROM playlists WHERE id = ?').get(id).r;
    const initialPayload = payloadOf('m3u');
    const initialRevision = revisionOf('m3u');
    const out = {};
    const movie = (extra = {}) => ({ playlistId: 'm3u', type: 'movie', stableId: 101, title: 'Film One', posterUrl: 'http://img.example.test/101.jpg', url: movieUrl(101, 'a'), favorite: true, ...extra });
    const series = (id, extra = {}) => ({ playlistId: 'm3u', type: 'series', stableId: id, title: 'Show ' + id, posterUrl: null, favorite: true, ...extra });
    const rows = () => favoriteRows(sqlite, 'm3u');
    const json = () => jsonFavorites(sqlite, 'm3u');

    out.movieAdded = ops.setM3uCatalogFavorite(db, movie());
    out.movieRows = rows();
    out.movieJson = json();
    out.movieAgainId = ops.setM3uCatalogFavorite(db, movie()).favoriteId;
    out.movieAgainRows = rows();
    out.movieAgainJson = json();
    ops.setM3uCatalogFavorite(db, movie({ url: movieUrl(101, 'rotated') }));
    out.rotatedRows = rows();
    out.rotatedJson = json();

    ops.setM3uCatalogFavorite(db, series(777));
    ops.setM3uCatalogFavorite(db, series(778));
    out.seriesAddedRows = rows().filter((r) => r.type === 'series');
    out.seriesAddedJson = json();
    out.seriesIds = ops.getM3uCatalogFavoriteIds(db, { playlistId: 'm3u', type: 'series' });
    out.movieIds = ops.getM3uCatalogFavoriteIds(db, { playlistId: 'm3u', type: 'movie' });
    ops.setM3uCatalogFavorite(db, series(777, { title: 'Show 777 renamed' }));
    out.seriesAgainRows = rows().filter((r) => r.type === 'series');
    out.seriesAgainJson = json();

    ops.setM3uCatalogFavorite(db, series(777, { favorite: false }));
    out.seriesRemovedRows = rows().filter((r) => r.type === 'series');
    out.seriesRemovedJson = json();
    ops.setM3uCatalogFavorite(db, movie({ favorite: false, url: movieUrl(101, 'other-token') }));
    out.movieRemovedRows = rows().filter((r) => r.type === 'movie');
    out.movieRemovedJson = json();
    out.removeMissing = ops.setM3uCatalogFavorite(db, series(999, { favorite: false }));
    out.untouchedPayload = payloadOf('m3u') === initialPayload;
    out.revisionKept = revisionOf('m3u') === initialRevision;

    const rejection = (request) => { try { ops.setM3uCatalogFavorite(db, request); return 'accepted'; } catch (error) { return String(error.message); } };
    out.xtreamRejected = rejection(series(5, { playlistId: 'xtream' }));
    out.invalidRejected = [
        rejection(series(0)),
        rejection(series(1.5)),
        rejection(series(3, { title: '  ' })),
        rejection({ ...series(3), type: 'live' }),
        rejection(series(3, { playlistId: '' })),
    ];

    insertM3u(sqlite, 'copy', [movieUrl(101, 'a'), movieUrl(102, 'a'), base + 'movie/u/p/101.mkv', live, base + 'series/u/p/55.mp4', 'm3u-series:777']);
    const copyJson = () => jsonFavorites(sqlite, 'copy');
    const copy = { jsonBefore: copyJson() };
    copy.first = ops.copyM3uCatalogFavoritesFromJson(db, 'copy');
    copy.rowsAfterFirst = favoriteRows(sqlite, 'copy');
    copy.jsonAfterFirst = copyJson();
    copy.second = ops.copyM3uCatalogFavoritesFromJson(db, 'copy');
    copy.rowsAfterSecond = favoriteRows(sqlite, 'copy');
    copy.jsonAfterSecond = copyJson();
    sqlite.prepare("DELETE FROM favorites WHERE playlist_id = 'copy' AND xtream_id = 102").run();
    ops.copyM3uCatalogFavoritesFromJson(db, 'copy');
    copy.afterRowRemoved = favoriteRows(sqlite, 'copy');
    copy.marks = markCount(sqlite, 'copy');
    out.copy = copy;

    insertM3u(sqlite, 'all-a', [movieUrl(102, 'a')]);
    insertM3u(sqlite, 'all-b', []);
    out.copyAll = {
        total: ops.copyAllM3uCatalogFavoritesFromJson(db),
        again: ops.copyAllM3uCatalogFavoritesFromJson(db),
        otherRows: favoriteRows(sqlite, 'all-b').length,
    };

    insertM3u(sqlite, 'bare', [movieUrl(101, 'a')], false);
    out.withoutPayload = {
        skipped: ops.copyM3uCatalogFavoritesFromJson(db, 'bare').skipped,
        marks: markCount(sqlite, 'bare'),
    };

    await playlistOps.deletePlaylist(db, 'copy');
    out.deleted = {
        rows: favoriteRows(sqlite, 'copy').length,
        marks: markCount(sqlite, 'copy'),
    };
    console.log(JSON.stringify(out));
    sqlite.close();
`;

const live = 'http://media.example.test/live/u/p/9.ts';
const movieA = 'http://media.example.test/movie/u/p/101.mp4?token=a';

describe('M3U catalog favorites in the favorites table', () => {
    let out: Output;

    beforeAll(() => {
        out = runCatalogFavoritesScript<Output>(SCRIPT);
    }, 60_000);

    it('upserts a movie with a NULL content id and keeps the URL in the JSON', () => {
        expect(out.movieAdded.favoriteId).toEqual(expect.any(Number));
        expect(out.movieRows).toEqual([
            {
                type: 'movie',
                stableId: 101,
                contentId: null,
                title: 'Film One',
                poster: 'http://img.example.test/101.jpg',
            },
        ]);
        expect(out.movieJson).toEqual([live, movieA]);
    });

    it('does not duplicate on a second identical write or a rotated token', () => {
        expect(out.movieAgainId).toBe(out.movieAdded.favoriteId);
        expect(out.movieAgainRows).toHaveLength(1);
        expect(out.movieAgainJson).toEqual([live, movieA]);
        expect(out.rotatedRows).toHaveLength(1);
        expect(out.rotatedJson).toEqual([live, movieA]);
    });

    it('upserts a series with a NULL content id and the m3u-series key', () => {
        expect(out.seriesAddedRows.map((row) => row.stableId)).toEqual([
            777, 778,
        ]);
        expect(out.seriesAddedRows.every((row) => row.contentId === null)).toBe(
            true
        );
        expect(out.seriesAddedJson).toEqual([
            live,
            movieA,
            'm3u-series:777',
            'm3u-series:778',
        ]);
        expect(out.seriesAgainRows).toHaveLength(2);
        expect(
            out.seriesAgainRows.find((row) => row.stableId === 777)?.title
        ).toBe('Show 777 renamed');
        expect(out.seriesAgainJson).toEqual(out.seriesAddedJson);
    });

    it('lists the stable ids per type, newest first', () => {
        expect(out.seriesIds).toEqual([778, 777]);
        expect(out.movieIds).toEqual([101]);
    });

    it('removes the series row and its key together', () => {
        expect(out.seriesRemovedRows.map((row) => row.stableId)).toEqual([
            778,
        ]);
        expect(out.seriesRemovedJson).not.toContain('m3u-series:777');
        expect(out.seriesRemovedJson).toContain('m3u-series:778');
    });

    it('removes the movie row and every URL with its stable id, keeping the live favorite', () => {
        expect(out.movieRemovedRows).toEqual([]);
        expect(out.movieRemovedJson).toEqual([live, 'm3u-series:778']);
        expect(out.removeMissing).toEqual({ favoriteId: null });
    });

    it('leaves the catalog payload and its revision alone', () => {
        expect(out.untouchedPayload).toBe(true);
        expect(out.revisionKept).toBe(true);
    });

    it('rejects a non M3U playlist and malformed requests', () => {
        expect(out.xtreamRejected).toBe('m3u_catalog_favorite_playlist_missing');
        expect(out.invalidRejected).toEqual(
            Array(5).fill('invalid_m3u_catalog_favorite')
        );
    });

    it('copies only the favorited movies from the JSON, once', () => {
        const { copy } = out;

        expect(copy.first).toEqual({ copied: 2, skipped: false });
        expect(copy.rowsAfterFirst.map((row) => row.stableId)).toEqual([
            101, 102,
        ]);
        expect(copy.rowsAfterFirst[0]).toEqual({
            type: 'movie',
            stableId: 101,
            contentId: null,
            title: 'Film One',
            poster: 'http://img.example.test/101.jpg',
        });
        expect(copy.second).toEqual({ copied: 0, skipped: true });
        expect(copy.rowsAfterSecond).toEqual(copy.rowsAfterFirst);
    });

    it('keeps every URL in the JSON when the copy runs twice', () => {
        const { copy } = out;

        expect(copy.jsonAfterFirst).toEqual(copy.jsonBefore);
        expect(copy.jsonAfterSecond).toEqual(copy.jsonBefore);
        expect(copy.jsonAfterSecond).toHaveLength(6);
    });

    it('does not bring a removed row back once the mark is set', () => {
        expect(out.copy.marks).toBe(1);
        expect(out.copy.afterRowRemoved.map((row) => row.stableId)).toEqual([
            101,
        ]);
    });

    it('copies pending playlists once and ignores those without favorites', () => {
        expect(out.copyAll).toEqual({ total: 1, again: 0, otherRows: 0 });
    });

    it('waits for the catalog payload instead of marking an empty copy', () => {
        expect(out.withoutPayload).toEqual({ skipped: true, marks: 0 });
    });

    it('deletes the rows and the mark with the playlist', () => {
        expect(out.deleted).toEqual({ rows: 0, marks: 0 });
    });
});
