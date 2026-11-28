import {
    isM3uSeriesFavoriteKey,
    m3uMovieStableId,
    m3uSeriesFavoriteKey,
} from './m3u-movie-stable-id.util';
import { hashM3uId } from './m3u-stable-id.util';

describe('m3uMovieStableId', () => {
    it('uses the stream id of an Xtream movie path', () => {
        expect(
            m3uMovieStableId('http://host.example.test/movie/user/pass/4521.mp4')
        ).toBe(4521);
        expect(
            m3uMovieStableId('http://host.example.test/movie/user/pass/4521')
        ).toBe(4521);
    });

    it('keeps the id when the token or the credentials rotate', () => {
        const first = m3uMovieStableId(
            'http://host.example.test/movie/u1/p1/77.mkv?token=aaa'
        );
        const second = m3uMovieStableId(
            'http://host.example.test:8080/movie/u2/p2/77.mkv?token=bbb#frag'
        );

        expect(first).toBe(77);
        expect(second).toBe(77);
    });

    it('hashes the URL without query and fragment when there is no Xtream path', () => {
        const bare = 'http://cdn.example.test/films/arrival.mp4';

        expect(m3uMovieStableId(`${bare}?token=1`)).toBe(hashM3uId(bare));
        expect(m3uMovieStableId(`${bare}?token=2#x`)).toBe(hashM3uId(bare));
        expect(m3uMovieStableId(bare)).toBe(hashM3uId(bare));
    });

    it('separates different films and stays a safe positive integer', () => {
        const a = m3uMovieStableId('http://cdn.example.test/films/a.mp4');
        const b = m3uMovieStableId('http://cdn.example.test/films/b.mp4');

        expect(a).not.toBe(b);
        expect(Number.isSafeInteger(a)).toBe(true);
        expect(a).toBeGreaterThan(0);
    });

    it('falls back to the hash for a non numeric or oversized stream id', () => {
        const url = 'http://host.example.test/movie/u/p/abc.mp4';
        const huge = 'http://host.example.test/movie/u/p/99999999999999999999.mp4';

        expect(m3uMovieStableId(url)).toBe(hashM3uId(url));
        expect(m3uMovieStableId(huge)).toBe(hashM3uId(huge));
    });
});

describe('m3u series favorite key', () => {
    it('round trips and is told apart from a URL', () => {
        const key = m3uSeriesFavoriteKey(123);

        expect(key).toBe('m3u-series:123');
        expect(isM3uSeriesFavoriteKey(key)).toBe(true);
        expect(isM3uSeriesFavoriteKey('http://host.example.test/a.mp4')).toBe(
            false
        );
    });
});
