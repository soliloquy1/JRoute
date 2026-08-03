// src/lib/db/connections.ts
import { getDb } from "./bootstrap.ts";
import { encrypt, decrypt } from "./encryption.ts";
import type { Connection } from "./types.ts";

interface ConnectionRow {
  id: number;
  provider_id: string;
  label: string;
  api_key: string | null;
  priority: number;
  cooldown_until: number | null;
  last_error: string | null;
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    providerId: row.provider_id,
    label: row.label,
    apiKey: decrypt(row.api_key) ?? null,
    priority: row.priority,
    cooldownUntil: row.cooldown_until,
    lastError: row.last_error,
  };
}

export function listConnections(providerId: string): Connection[] {
  const rows = getDb()
    .prepare("SELECT * FROM connections WHERE provider_id = ? ORDER BY priority ASC, id ASC")
    .all(providerId) as ConnectionRow[];
  return rows.map(toConnection);
}

export function createConnection(providerId: string, label: string, apiKey: string): number {
  const info = getDb()
    .prepare("INSERT INTO connections (provider_id, label, api_key) VALUES (?, ?, ?)")
    .run(providerId, label, encrypt(apiKey));
  return Number(info.lastInsertRowid);
}

export function markCooldown(id: number, untilMs: number, error: string): void {
  getDb()
    .prepare("UPDATE connections SET cooldown_until = ?, last_error = ? WHERE id = ?")
    .run(untilMs, error, id);
}

export function clearCooldown(id: number): void {
  getDb()
    .prepare("UPDATE connections SET cooldown_until = NULL, last_error = NULL WHERE id = ?")
    .run(id);
}
