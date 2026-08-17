import type { Connection } from "../src/lib/db/types.ts";
import type { FallbackStrategy } from "../src/lib/db/settings.ts";

/**
 * Spec §5 step 9. Cooldowns are lazy: a `cooldownUntil` in the past makes the
 * connection eligible again without any background timer clearing it.
 *
 * Phase 4: also skips connections that have exhausted their configured quota window
 * (`quota_window_thresholds_json`), so a request auto-routes away from a connection
 * that has hit its provider limit. No combo engine — pure threshold check per the
 * active rolling window.
 *
 * Housekeeping: `isOverQuota` is injected (never `getDb()`-queried inside this
 * module) so this file stays DB-free and unit-testable in isolation — same principle
 * as `executor.ts`'s injected `tokenResolver` (plan step 13).
 */
export function eligibleConnections(
  all: Connection[],
  now: number,
  isOverQuota: (connection: Connection, now: number) => boolean
): Connection[] {
  return all
    .filter((c) => c.enabled && (c.cooldownUntil === null || c.cooldownUntil <= now))
    .filter((c) => !isOverQuota(c, now))
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
}

/**
 * Phase 4 step 21: apply the operator's global fallback-strategy setting. `priority`
 * (default) leaves the priority-then-id order from `eligibleConnections` untouched.
 * `round-robin` rotates the list to start right after the last connection that was
 * actually dialed for this provider (`provider_routing_state`), so consecutive
 * requests spread across a provider's connections instead of always preferring the
 * same lowest-priority one first — the rest of the list, used for in-request
 * failover, keeps its relative priority order. No combo engine: this is a pure array
 * rotation, not a scoring/weighting system.
 *
 * `getLastConnectionId` is injected for the same DB-free-module reason as
 * `isOverQuota` above.
 */
export function applyFallbackStrategy(
  connections: Connection[],
  strategy: FallbackStrategy,
  providerId: string,
  getLastConnectionId: (providerId: string) => number | null
): Connection[] {
  if (strategy !== "round-robin" || connections.length <= 1) return connections;
  const lastId = getLastConnectionId(providerId);
  if (lastId === null) return connections;
  const lastIndex = connections.findIndex((c) => c.id === lastId);
  if (lastIndex === -1) return connections;
  const nextIndex = (lastIndex + 1) % connections.length;
  return [...connections.slice(nextIndex), ...connections.slice(0, nextIndex)];
}
