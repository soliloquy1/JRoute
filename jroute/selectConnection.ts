import type { Connection } from "../src/lib/db/types.ts";
import { isOverQuota } from "../src/lib/db/quotaWindows.ts";

/**
 * Spec §5 step 9. Cooldowns are lazy: a `cooldownUntil` in the past makes the
 * connection eligible again without any background timer clearing it.
 *
 * Phase 4: also skips connections that have exhausted their configured quota window
 * (`quota_window_thresholds_json`), so a request auto-routes away from a connection
 * that has hit its provider limit. No combo engine — pure threshold check per the
 * active rolling window.
 */
export function eligibleConnections(all: Connection[], now: number): Connection[] {
  return all
    .filter((c) => c.enabled && (c.cooldownUntil === null || c.cooldownUntil <= now))
    .filter((c) => !isOverQuota(c, now))
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
}
