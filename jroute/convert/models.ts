// jroute/convert/models.ts
//
// The model catalog is now operator-editable and lives in the `models` DB table
// (src/lib/db/models.ts). This module is a thin, backward-compatible adapter so
// legacy importers (testConnection, preview, /v1/models) keep working. The DB is
// the single source of truth — `MODEL_MAP` is retained only as the seed defaults
// for reference and is no longer used for resolution.
import { listModels, resolveClientModel } from "@/lib/db/models.ts";

export interface ModelEntry {
  providerId: string;
  maxTokens: number;
}

/** Seed defaults — the static map that Plan 7 replaced with the operator-editable table. */
export const MODEL_MAP: Record<string, ModelEntry> = {
  "claude-sonnet-4-6": { providerId: "anthropic", maxTokens: 64000 },
  "claude-opus-4-8": { providerId: "anthropic", maxTokens: 32000 },
  "claude-haiku-4-5": { providerId: "anthropic", maxTokens: 32000 },
  "gpt-4o": { providerId: "openai", maxTokens: 16384 },
  "gpt-4o-mini": { providerId: "openai", maxTokens: 16384 },
  "gemini-2.0-flash": { providerId: "google", maxTokens: 8192 },
};

export function lookupModel(model: string): ModelEntry | null {
  const resolved = resolveClientModel(model);
  return resolved ? { providerId: resolved.providerId, maxTokens: resolved.maxTokens } : null;
}

export function listModelIds(): string[] {
  return listModels().map((m) => m.clientId);
}
