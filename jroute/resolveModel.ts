import { getProvider } from "../src/lib/db/providers.ts";
import { resolveClientModel } from "../src/lib/db/models.ts";
import type { Provider } from "../src/lib/db/types.ts";

export interface ResolvedModel {
  /** Client-facing model string (what the client sent, may include a prefix). */
  model: string;
  provider: Provider;
  maxTokens: number;
  /** Native model id sent upstream (prefix stripped). */
  nativeModel: string;
}

/**
 * Maps a client-supplied `model` to the provider that serves it.
 *
 * Resolution is provider-scoped: a `prefix/nativeId` request resolves via the
 * provider's `model_prefix`, and a bare id falls back to empty-prefix providers
 * (the seeded legacy defaults). Returns null when the model is unknown, the
 * mapped provider is missing/disabled, or no model is registered — callers turn
 * that into a 404, distinct from the "no provider configured" / "no connection"
 * 503s.
 */
export function resolveModel(model: string): ResolvedModel | null {
  const resolved = resolveClientModel(model);
  if (!resolved) return null;

  const provider = getProvider(resolved.providerId);
  if (!provider || !provider.enabled) return null;

  return { model, provider, maxTokens: resolved.maxTokens, nativeModel: resolved.nativeModel };
}
