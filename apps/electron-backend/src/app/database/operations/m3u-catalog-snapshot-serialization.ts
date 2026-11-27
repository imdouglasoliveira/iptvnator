import type { M3uCatalogSnapshot } from '@iptvnator/shared/m3u-utils/catalog';

export const SNAPSHOT_BYTES_LIMIT = 10 * 1024 * 1024;
const CHUNK_LENGTH = 64 * 1024;

export function* serializeM3uCatalogSnapshot({
    series,
    groups,
    kinds,
    ...metadata
}: M3uCatalogSnapshot): Generator<void, string | undefined> {
    const header = JSON.stringify(metadata).slice(0, -1);
    const available = SNAPSHOT_BYTES_LIMIT - Buffer.byteLength(header);
    const indexFallback = ',"kinds":"","groups":[]';
    const seriesFallback = ',"series":null}';

    const encodedIndex =
        kinds.length > 0
            ? yield* encodeSection(
                  { kinds, groups },
                  available - Buffer.byteLength(seriesFallback)
              )
            : undefined;
    // Replacing the index object's outer braces drops one byte overall.
    const indexPart = encodedIndex
        ? ',' + encodedIndex.text.slice(1, -1)
        : indexFallback;
    const indexBytes = encodedIndex
        ? encodedIndex.bytes - 1
        : Buffer.byteLength(indexFallback);

    const seriesPrefix = ',"series":';
    const seriesBudget =
        available - indexBytes - Buffer.byteLength(seriesPrefix) - 1;
    const encodedSeries =
        series !== null && seriesBudget >= 2
            ? yield* encodeSection(series, seriesBudget)
            : undefined;

    if (!encodedIndex && !encodedSeries) return undefined;

    return [
        header,
        indexPart,
        encodedSeries ? seriesPrefix + encodedSeries.text + '}' : seriesFallback,
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
