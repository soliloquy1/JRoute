/**
 * JRoute has no models table and no provider registry: migration 001 creates six tables,
 * none of them a catalog, and OmniRoute's `providerRegistry` is the 236-file import
 * closure the product spec (§2.1) deliberately refuses to vendor. This static map is the
 * Plan 2 answer. Plan 7 replaces it with an operator-editable table once the dashboard
 * exists to edit one.
 *
 * `maxTokens` is the per-model value used to satisfy Anthropic's required `max_tokens`
 * parameter (Plan 2a Task 6). It is the model's OUTPUT ceiling, not its context window.
 */

export interface ModelEntry {
  providerId: string;
  maxTokens: number;
}

export const MODEL_MAP: Record<string, ModelEntry> = {
  "claude-sonnet-4-6": { providerId: "anthropic", maxTokens: 64000 },
  "claude-opus-4-8": { providerId: "anthropic", maxTokens: 32000 },
  "claude-haiku-4-5": { providerId: "anthropic", maxTokens: 32000 },
  "gpt-4o": { providerId: "openai", maxTokens: 16384 },
  "gpt-4o-mini": { providerId: "openai", maxTokens: 16384 },
};

export function lookupModel(model: string): ModelEntry | null {
  return Object.prototype.hasOwnProperty.call(MODEL_MAP, model) ? MODEL_MAP[model] : null;
}

export function listModelIds(): string[] {
  return Object.keys(MODEL_MAP);
}
