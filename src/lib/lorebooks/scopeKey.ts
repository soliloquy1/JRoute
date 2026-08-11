// src/lib/lorebooks/scopeKey.ts
import { createHash } from "node:crypto";

/**
 * Design spec §7.3: `ctx.vars` scope key. `global` is the literal string, shared across
 * every character. `character` (the default) hashes the NORMALIZED raw Janitor system
 * prompt — normalization (trim, collapse internal whitespace, lowercase) means a cosmetic
 * edit to the card does not orphan every var the lorebook has accumulated. The caller is
 * responsible for passing the RAW prompt captured before JRoute's own prepend/append stage
 * (§7.3 mandatory detail #1) — this function only normalizes and hashes what it's given.
 */
export function scopeKeyFor(scope: "character" | "global", rawSystemPrompt: string): string {
  if (scope === "global") return "global";
  const normalized = rawSystemPrompt.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}
