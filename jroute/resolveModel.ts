import { getProvider } from "../src/lib/db/providers.ts";
import { lookupModel } from "./convert/models.ts";
import type { Provider } from "../src/lib/db/types.ts";

export interface ResolvedModel {
  model: string;
  provider: Provider;
  maxTokens: number;
}

/**
 * Maps a client-supplied `model` to the provider that serves it.
 *
 * Returns null for three distinct situations that all mean "this model cannot be served":
 * the id is not in MODEL_MAP, the mapped provider row does not exist, or it is disabled.
 * The caller (Task 9) turns that into a 404, which is deliberately distinct from Plan 1's
 * "No provider configured" and "No available connection" 503s — a client asking for a
 * model that does not exist is a different problem from an operator misconfiguration.
 */
export function resolveModel(model: string): ResolvedModel | null {
  const entry = lookupModel(model);
  if (!entry) return null;

  const provider = getProvider(entry.providerId);
  if (!provider || !provider.enabled) return null;

  return { model, provider, maxTokens: entry.maxTokens };
}
