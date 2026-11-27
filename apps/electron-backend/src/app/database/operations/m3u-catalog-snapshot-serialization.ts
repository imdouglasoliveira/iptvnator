import type { M3uCatalogSnapshot } from '@iptvnator/shared/m3u-utils/catalog';

export const SNAPSHOT_BYTES_LIMIT = 10 * 1024 * 1024;
const CHUNK_LENGTH = 64 * 1024;

export function* serializeM3uCatalogSnapshot({
    series,
    groups,
    kinds,
    ...metadata
}: M3uCatalogSnapshot): Generator<void, string | undefined> {
    const header = JSON.stringify(metadata).slice(0, -1) + ',"series":';
    const fallback = ',"kinds":"","groups":[]}';
    const available = SNAPSHOT_BYTES_LIMIT - Buffer.byteLength(header);
    const encodedSeries = yield* encodeSection(
        series,
        available - Buffer.byteLength(fallback)
    );
    if (!encodedSeries) return undefined;

    const tail = yield* encodeSection(
        { kinds, groups },
        available - encodedSeries.bytes
    );
    // Replacing the tail's opening brace with a comma keeps its byte length.
    return [
        header,
        encodedSeries.text,
        tail ? ',' + tail.text.slice(1) : fallback,
    ].join('');
}

function* encodeSection(
    value: unknown,
    budget: number
): Generator<void, { text: string; bytes: number } | undefined> {
    const chunks: string[] = [];
    let chunk = '';
    let bytes = 0;
    let tokens = 0;
    for (const token of jsonTokens(value)) {
        bytes += Buffer.byteLength(token);
        if (bytes > budget) return undefined;
        chunk += token;
        if (chunk.length >= CHUNK_LENGTH || ++tokens >= 2048) {
            chunks.push(chunk);
            chunk = '';
            tokens = 0;
            yield;
        }
    }
    chunks.push(chunk);
    return { text: chunks.join(''), bytes };
}

// Snapshot data consists of plain objects, arrays and JSON primitives.
function* jsonTokens(value: unknown): Generator<string> {
    if (Array.isArray(value)) {
        yield '[';
        let separator = '';
        for (const item of value) {
            yield separator;
            yield* jsonTokens(item ?? null);
            separator = ',';
        }
        yield ']';
    } else if (value !== null && typeof value === 'object') {
        yield '{';
        let separator = '';
        for (const [key, field] of Object.entries(value)) {
            if (field === undefined) continue;
            yield separator + JSON.stringify(key) + ':';
            yield* jsonTokens(field);
            separator = ',';
        }
        yield '}';
    } else if (typeof value === 'string' && value.length > CHUNK_LENGTH) {
        yield '"';
        for (let start = 0; start < value.length; ) {
            let end = Math.min(start + CHUNK_LENGTH, value.length);
            const last = value.charCodeAt(end - 1);
            if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
            yield JSON.stringify(value.slice(start, end)).slice(1, -1);
            start = end;
        }
        yield '"';
    } else {
        yield JSON.stringify(value);
    }
}
