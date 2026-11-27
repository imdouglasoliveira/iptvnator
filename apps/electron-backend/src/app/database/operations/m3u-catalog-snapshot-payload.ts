import type { Channel } from '@iptvnator/shared/interfaces';

const SCAN_BATCH = 64 * 1024;
const MAX_CHANNEL_LENGTH = 1024 * 1024;

// The stored document is JSON from the playlist codec; only its channel rows are needed.
export function* readM3uSnapshotChannels(
    payload: string
): Generator<void, Channel[] | undefined> {
    const cursor = new PayloadCursor(payload);
    let channels: Channel[] | undefined;
    if (yield* cursor.take('{')) {
        yield* cursor.members(function* (key) {
            if (key !== 'playlist' || !(yield* cursor.take('{'))) {
                yield* cursor.skipValue();
                if (key === 'playlist') channels = undefined;
                return;
            }

            channels = undefined;
            yield* cursor.members(function* (field) {
                if (field !== 'items' || !(yield* cursor.take('['))) {
                    yield* cursor.skipValue();
                    if (field === 'items') channels = undefined;
                    return;
                }
                const rows: Channel[] = [];
                if (!(yield* cursor.take(']'))) {
                    do {
                        yield* cursor.skipWhitespace();
                        const start = cursor.position;
                        yield* cursor.skipValue();
                        if (cursor.position - start > MAX_CHANNEL_LENGTH) {
                            throw new Error(
                                'M3U channel exceeds snapshot parse budget'
                            );
                        }
                        rows.push(
                            JSON.parse(payload.slice(start, cursor.position))
                        );
                    } while (yield* cursor.take(','));
                    yield* cursor.expect(']');
                }
                channels = rows;
            });
        });
    } else {
        yield* cursor.skipValue();
    }
    yield* cursor.skipWhitespace();
    if (cursor.position !== payload.length) throw new SyntaxError();
    return channels;
}

const CONTROL_RANGE = `${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}`;

class PayloadCursor {
    position = 0;
    private checkpoint = 0;
    private readonly whitespace = /[ \t\r\n]{1,8192}/y;
    private readonly stringPart = new RegExp(
        String.raw`[^"\\${CONTROL_RANGE}]{1,8192}|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})`,
        'y'
    );
    private readonly literal =
        /true|false|null|-?(?:0|[1-9]\d{0,1023})(?:\.\d{1,1024})?(?:[eE][+-]?\d{1,1024})?/y;

    constructor(private readonly text: string) {}

    *skipWhitespace(): Generator<void> {
        while (this.match(this.whitespace)) yield* this.pause();
    }

    *take(character: string): Generator<void, boolean> {
        yield* this.skipWhitespace();
        yield* this.pause();
        if (this.text[this.position] !== character) return false;
        this.position++;
        return true;
    }

    *expect(character: string): Generator<void> {
        if (!(yield* this.take(character))) throw new SyntaxError();
    }

    *members(read?: (key?: string) => Generator<void>): Generator<void> {
        if (yield* this.take('}')) return;
        do {
            yield* this.skipWhitespace();
            const start = this.position;
            yield* this.skipString();
            const end = this.position;
            yield* this.expect(':');
            if (read) {
                // Both sought keys fit in 50 code units even when fully escaped.
                const key =
                    end - start <= 50
                        ? (JSON.parse(this.text.slice(start, end)) as string)
                        : undefined;
                yield* read(key);
            } else {
                yield* this.skipValue();
            }
        } while (yield* this.take(','));
        yield* this.expect('}');
    }

    *skipValue(): Generator<void> {
        yield* this.skipWhitespace();
        yield* this.pause();
        switch (this.text[this.position]) {
            case '"':
                yield* this.skipString();
                return;
            case '{':
                this.position++;
                yield* this.members();
                return;
            case '[':
                this.position++;
                if (yield* this.take(']')) return;
                do {
                    yield* this.skipValue();
                } while (yield* this.take(','));
                yield* this.expect(']');
                return;
            default:
                if (!this.match(this.literal)) throw new SyntaxError();
        }
    }

    private *skipString(): Generator<void> {
        if (this.text[this.position++] !== '"') throw new SyntaxError();
        while (this.match(this.stringPart)) yield* this.pause();
        if (this.text[this.position++] !== '"') throw new SyntaxError();
    }

    private match(pattern: RegExp): boolean {
        pattern.lastIndex = this.position;
        if (!pattern.test(this.text)) return false;
        this.position = pattern.lastIndex;
        return true;
    }

    private *pause(): Generator<void> {
        if (this.position - this.checkpoint < SCAN_BATCH) return;
        this.checkpoint = this.position;
        yield;
    }
}
