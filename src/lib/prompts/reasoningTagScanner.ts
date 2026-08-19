// src/lib/prompts/reasoningTagScanner.ts
import type { ReasoningTagPair } from "./reasoningTagSchema.ts";

type Phase = "detecting" | "outside" | "inside" | "discarding";

export interface ReasoningScanner {
  push(chunk: string): string;
  finish(): string;
}

interface EarliestMatch {
  index: number;
  tag: string;
  kind: "open" | "close";
  pairIndex: number;
}

function findEarliest(buffer: string, tagPairs: ReasoningTagPair[]): EarliestMatch | null {
  let best: EarliestMatch | null = null;
  tagPairs.forEach((pair, pairIndex) => {
    (
      [
        [pair.openTag, "open"],
        [pair.closeTag, "close"],
      ] as const
    ).forEach(([tag, kind]) => {
      const index = buffer.indexOf(tag);
      if (index === -1) return;
      if (best === null || index < best.index) {
        best = { index, tag, kind, pairIndex };
      }
    });
  });
  return best;
}

// Longest suffix of `text` that is a proper prefix of some candidate tag — held back so a
// tag split across chunk boundaries is never partially emitted.
function longestSuffixTagPrefix(text: string, tags: string[]): number {
  let maxLen = 0;
  for (const tag of tags) {
    const limit = Math.min(tag.length - 1, text.length);
    for (let len = limit; len > 0; len -= 1) {
      if (text.endsWith(tag.slice(0, len))) {
        if (len > maxLen) maxLen = len;
        break;
      }
    }
  }
  return maxLen;
}

const REASONING_MEMORY_CAP = 20000;

export function createReasoningScanner(tagPairs: ReasoningTagPair[]): ReasoningScanner {
  const allTags = tagPairs.flatMap((p) => [p.openTag, p.closeTag]);
  const maxCloseTagLen = Math.max(1, ...tagPairs.map((p) => p.closeTag.length));
  let phase: Phase = tagPairs.some((p) => p.expectImplicitOpen) ? "detecting" : "outside";
  let buffer = "";
  let activePairIndex = -1;

  function emitTailSafe(text: string): string {
    const holdLen = longestSuffixTagPrefix(text, allTags);
    buffer = text.slice(text.length - holdLen);
    return text.slice(0, text.length - holdLen);
  }

  function drive(): string {
    let out = "";
    for (;;) {
      if (phase === "outside") {
        const earliest = findEarliest(buffer, tagPairs);
        if (!earliest) {
          out += emitTailSafe(buffer);
          break;
        }
        if (earliest.kind === "open") {
          out += buffer.slice(0, earliest.index);
          buffer = buffer.slice(earliest.index + earliest.tag.length);
          phase = "inside";
          activePairIndex = earliest.pairIndex;
          continue;
        }
        out += buffer.slice(0, earliest.index);
        buffer = buffer.slice(earliest.index + earliest.tag.length);
        continue;
      }

      if (phase === "detecting") {
        const earliest = findEarliest(buffer, tagPairs);
        if (!earliest) {
          if (buffer.length > REASONING_MEMORY_CAP) {
            out += emitTailSafe(buffer);
            phase = "outside";
            continue;
          }
          break;
        }
        if (earliest.kind === "open") {
          out += buffer.slice(0, earliest.index);
          buffer = buffer.slice(earliest.index + earliest.tag.length);
          phase = "inside";
          activePairIndex = earliest.pairIndex;
          continue;
        }
        if (tagPairs[earliest.pairIndex].expectImplicitOpen) {
          buffer = buffer.slice(earliest.index + earliest.tag.length);
          phase = "outside";
          continue;
        }
        // Stray close from a pair that promised an explicit open — splice it out, keep
        // waiting (nothing emitted yet; other pairs may still resolve).
        buffer = buffer.slice(0, earliest.index) + buffer.slice(earliest.index + earliest.tag.length);
        continue;
      }

      if (phase === "inside") {
        const closeTag = tagPairs[activePairIndex].closeTag;
        const closeIdx = buffer.indexOf(closeTag);
        if (closeIdx === -1) {
          if (buffer.length > REASONING_MEMORY_CAP) {
            buffer = buffer.slice(Math.max(0, buffer.length - (maxCloseTagLen - 1)));
            phase = "discarding";
            continue;
          }
          break;
        }
        buffer = buffer.slice(closeIdx + closeTag.length);
        phase = "outside";
        continue;
      }

      // phase === "discarding": bounded-memory continuation of an over-cap "inside" block.
      {
        const closeTag = tagPairs[activePairIndex].closeTag;
        const closeIdx = buffer.indexOf(closeTag);
        if (closeIdx === -1) {
          buffer = buffer.slice(Math.max(0, buffer.length - (maxCloseTagLen - 1)));
          break;
        }
        buffer = buffer.slice(closeIdx + closeTag.length);
        phase = "outside";
        continue;
      }
    }
    return out;
  }

  return {
    push(chunk: string): string {
      buffer += chunk;
      return drive();
    },
    finish(): string {
      // Naturally idempotent: every branch below settles into phase "outside" with an
      // empty buffer, so a repeat call falls through to the final `return out` with
      // `out === ""` — no separate flushed flag needed.
      if (phase === "detecting") {
        const out = buffer;
        buffer = "";
        phase = "outside";
        return out;
      }
      if (phase === "inside" || phase === "discarding") {
        buffer = "";
        phase = "outside";
        return "";
      }
      const out = buffer;
      buffer = "";
      return out;
    },
  };
}

export function hasReasoningTags(tagPairs: ReasoningTagPair[]): boolean {
  return tagPairs.length > 0;
}

export function applyReasoningTagStrip(text: string, tagPairs: ReasoningTagPair[]): string {
  if (tagPairs.length === 0) return text;
  const scanner = createReasoningScanner(tagPairs);
  return scanner.push(text) + scanner.finish();
}
