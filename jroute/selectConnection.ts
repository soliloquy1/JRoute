import type { Connection } from "../src/lib/db/types.ts";

/**
 * Spec §5 step 9. Cooldowns are lazy: a `cooldownUntil` in the past makes the
 * connection eligible again without any background timer clearing it.
 */
export function eligibleConnections(all: Connection[], now: number): Connection[] {
  return all
    .filter((c) => c.cooldownUntil === null || c.cooldownUntil <= now)
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
}
