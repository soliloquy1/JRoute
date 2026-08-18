// src/lib/db/settings.ts
import { getDb } from "./bootstrap.ts";

export type FallbackStrategy = "priority" | "round-robin";

const FALLBACK_STRATEGY_KEY = "fallbackStrategy";
const DEFAULT_FALLBACK_STRATEGY: FallbackStrategy = "priority";

function isFallbackStrategy(value: unknown): value is FallbackStrategy {
  return value === "priority" || value === "round-robin";
}

/** Generic key/value read — used by the typed getters/setters below. */
export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

/** Global default connection-selection order. `priority` (default) always prefers the
 * lowest-priority connection first, same as today. `round-robin` rotates the first
 * pick across a provider's eligible connections so no single connection is always
 * hammered first — see provider_routing_state / selectConnection.ts. */
export function getFallbackStrategy(): FallbackStrategy {
  const value = getSetting(FALLBACK_STRATEGY_KEY);
  return isFallbackStrategy(value) ? value : DEFAULT_FALLBACK_STRATEGY;
}

export function setFallbackStrategy(strategy: FallbackStrategy): void {
  setSetting(FALLBACK_STRATEGY_KEY, strategy);
}

const ACTIVE_SEARCH_PROVIDER_KEY = "activeSearchProviderId";

/** `null` means no search provider configured — `web_search` must degrade to a tool-error
 * content block, not throw, matching every other tool-failure path in this codebase. */
export function getActiveSearchProviderId(): number | null {
  const value = getSetting(ACTIVE_SEARCH_PROVIDER_KEY);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function setActiveSearchProviderId(id: number | null): void {
  if (id === null) {
    getDb().prepare("DELETE FROM settings WHERE key = ?").run(ACTIVE_SEARCH_PROVIDER_KEY);
    return;
  }
  setSetting(ACTIVE_SEARCH_PROVIDER_KEY, String(id));
}
