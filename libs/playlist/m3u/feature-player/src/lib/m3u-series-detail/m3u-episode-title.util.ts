/**
 * Words providers append after the episode marker that describe the file,
 * not the episode: "Show S01E01 1080p TR", "Show 1x01 [FHD] Dublado".
 * A tail made only of these is no title, so the episode card falls back to
 * its numbered label instead of printing "1080p TR" as the name.
 */
const FILE_DESCRIPTOR =
    /^(?:\d{3,4}p|\d{1,2}k|uhd|fhd|hd|sd|hq|hevc|avc|h\.?26[45]|x26[45]|hdr\d*|web-?dl|web-?rip|blu-?ray|bdrip|dvdrip|hdtv|dual|dub|dubbed|dublado|legendado|legenda|sub|subs|subbed|multi|vostfr|vf|vo)$/i;

/** Upper case only: "TR" and "PT-BR" are tags, "It" and "Go" are words. */
const LANGUAGE_TAG = /^[A-Z]{2}(?:-[A-Z]{2})?$/;

/**
 * The tail the provider wrote after the marker, or '' when it only
 * describes the file. Never invents text: what survives is the provider's.
 */
export function m3uEpisodeDisplayTitle(tail: string | null): string {
    const text = (tail ?? '').trim();
    if (!text) {
        return '';
    }
    const words = text.split(/[\s[\](){}|,_/]+/u).filter(Boolean);
    return words.every(
        (word) => FILE_DESCRIPTOR.test(word) || LANGUAGE_TAG.test(word)
    ) ? '' : text;
}
