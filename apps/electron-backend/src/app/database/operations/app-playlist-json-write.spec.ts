import {
    APP_PLAYLIST_JSON_WRITE_FORMAT,
    decodeAppPlaylistWritePayload,
} from './app-playlist-json-write';

const playlist = { _id: 'playlist-1', title: 'Synthetic' };

describe('decodeAppPlaylistWritePayload', () => {
    it('parses the JSON text envelope into the playlist object', () => {
        expect(
            decodeAppPlaylistWritePayload({
                format: APP_PLAYLIST_JSON_WRITE_FORMAT,
                json: JSON.stringify(playlist),
            })
        ).toEqual(playlist);
    });

    it('passes the object payload through unchanged', () => {
        expect(decodeAppPlaylistWritePayload(playlist)).toBe(playlist);
    });

    it('rejects malformed JSON without echoing its content', () => {
        const secret = 'https://example.test/secret-token';
        let message = '';
        try {
            decodeAppPlaylistWritePayload({
                format: APP_PLAYLIST_JSON_WRITE_FORMAT,
                json: `{"url":"${secret}",`,
            });
        } catch (error) {
            message = (error as Error).message;
        }

        expect(message).toBe('Invalid playlist JSON payload');
        expect(message).not.toContain(secret);
    });

    it('rejects JSON that is not an object', () => {
        for (const json of ['[]', 'null', '"text"', '42']) {
            expect(() =>
                decodeAppPlaylistWritePayload({
                    format: APP_PLAYLIST_JSON_WRITE_FORMAT,
                    json,
                })
            ).toThrow('Invalid playlist JSON payload');
        }
    });
});
