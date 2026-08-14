// src/lib/prompts/logitBias.ts
import { getEncoding } from "js-tiktoken";
import type { LogitBiasEntry } from "./logitBiasSchema.ts";

// Deliberately the single generic encoder for all entries, regardless of the request's
// target model (spec §2) — JRoute proxies ~290 providers; replicating SillyTavern's full
// per-model-family tokenizer selection (tiktoken + sentencepiece + web tokenizers) is
// disproportionate. Raw token-ID-array entries are the escape hatch for operators who
// need exact IDs for a specific model's real vocabulary.
let encoder: ReturnType<typeof getEncoding> | null = null;
function getEncoder() {
  if (!encoder) encoder = getEncoding("cl100k_base");
  return encoder;
}

/**
 * Vendored from SillyTavern's `/api/backends/chat-completions/bias` route
 * (`src/endpoints/backends/chat-completions.js`, `getEntryTokens`): a JSON array literal
 * of numbers is treated as raw token IDs; anything else is tokenized as text.
 */
export function resolveTokenIds(text: string): number[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "number")) {
        return parsed;
      }
    } catch {
      // fall through to tokenizing the literal text below
    }
  }
  if (text.length === 0) return [];
  return Array.from(getEncoder().encode(text));
}

export function computeLogitBias(entries: LogitBiasEntry[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const { text, value } of entries) {
    for (const tokenId of resolveTokenIds(text)) {
      result[String(tokenId)] = value;
    }
  }
  return result;
}
