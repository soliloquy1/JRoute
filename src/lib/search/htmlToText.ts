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

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const cp = parseInt(code.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
    }
    if (code.startsWith("#")) {
      const cp = parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
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
