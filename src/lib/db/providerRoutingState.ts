// src/lib/db/providerRoutingState.ts
import { getDb } from "./bootstrap.ts";

/** Last connection id successfully dialed for `providerId`, or null if none recorded
 * yet (fresh provider, or every dial has failed so far). */
export function getLastConnectionId(providerId: string): number | null {
  const row = getDb()
    .prepare("SELECT last_connection_id FROM provider_routing_state WHERE provider_id = ?")
    .get(providerId) as { last_connection_id: number | null } | undefined;
  return row?.last_connection_id ?? null;
}

export function setLastConnectionId(providerId: string, connectionId: number): void {
  getDb()
    .prepare(
      `INSERT INTO provider_routing_state (provider_id, last_connection_id) VALUES (?, ?)
       ON CONFLICT(provider_id) DO UPDATE SET last_connection_id = excluded.last_connection_id`
    )
    .run(providerId, connectionId);
}
