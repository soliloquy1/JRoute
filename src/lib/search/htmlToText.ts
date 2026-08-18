// src/lib/search/htmlToText.ts
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
};

const MAX_CODE_POINT = 0x10ffff;

/** `Number.isFinite` alone is not enough: `String.fromCodePoint` throws `RangeError` for
 * anything above U+10FFFF, and that exception escapes the whole extraction. Out-of-range
 * entities are left as literal text instead. */
function decodeCodePoint(cp: number, fallback: string): string {
  if (!Number.isInteger(cp) || cp < 0 || cp > MAX_CODE_POINT) return fallback;
  return String.fromCodePoint(cp);
}

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return decodeCodePoint(parseInt(code.slice(2), 16), match);
    }
    if (code.startsWith("#")) {
      return decodeCodePoint(parseInt(code.slice(1), 10), match);
    }
    return ENTITIES[code] ?? match;
  });
}

/** Pragmatic, non-DOM HTML-to-text extraction — not Readability-grade content extraction.
 * Good enough to hand a model page text; see design spec §5 for why this is deliberate
 * (no jsdom/@mozilla/readability production dependency for this). */
export function htmlToText(html: string, maxLength: number): string {
  const withoutScriptsAndStyles = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutTags = withoutScriptsAndStyles.replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(withoutTags);
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, maxLength);
}
