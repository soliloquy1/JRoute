// src/lib/db/connections.ts
import { getDb } from "./bootstrap.ts";
import { encrypt, decrypt, looksEncrypted } from "./encryption.ts";
import type { Connection } from "./types.ts";

interface ConnectionRow {
  id: number;
  provider_id: string;
  label: string;
  api_key: string | null;
  priority: number;
  cooldown_until: number | null;
  last_error: string | null;
  enabled: number;
  provider_specific_data: string | null;
  quota_window_thresholds_json: string | null;
}

function toConnection(row: ConnectionRow): Connection {
  const apiKey = decrypt(row.api_key) ?? null;
  // decrypt() returns null both for a genuinely absent key and for a stored
  // ciphertext it could not open (rotated/lost STORAGE_ENCRYPTION_KEY, or a
  // corrupted value). Only the latter carries the `enc:v1:` prefix, so use it
  // to tell the two apart instead of letting a lost key masquerade as "no
  // credential configured". Mirrors decryptConnectionFields() in encryption.ts.
  const credentialDecryptFailed = looksEncrypted(row.api_key) && apiKey === null;

  if (credentialDecryptFailed) {
    // Never log the ciphertext or any part of the key — ids only.
    console.warn(
      `[connections] Connection id=${row.id} (provider=${row.provider_id}) has an ` +
        `encrypted api_key that could not be decrypted. STORAGE_ENCRYPTION_KEY may have ` +
        `changed or the stored value is corrupted.`
    );
  }

  return {
    id: row.id,
    providerId: row.provider_id,
    label: row.label,
    apiKey,
    priority: row.priority,
    cooldownUntil: row.cooldown_until,
    lastError: row.last_error,
    credentialDecryptFailed,
    enabled: row.enabled !== 0,
    providerSpecificData: row.provider_specific_data ?? null,
    quotaWindowThresholds: row.quota_window_thresholds_json ?? null,
  };
}

export function listConnections(providerId: string): Connection[] {
  const rows = getDb()
    .prepare("SELECT * FROM connections WHERE provider_id = ? ORDER BY priority ASC, id ASC")
    .all(providerId) as ConnectionRow[];
  return rows.map(toConnection);
}

export function createConnection(
  providerId: string,
  label: string,
  apiKey: string,
  extra: {
    providerSpecificData?: string | null;
    quotaWindowThresholds?: string | null;
    priority?: number;
  } = {}
): number {
  const info = getDb()
    .prepare(
      `INSERT INTO connections
        (provider_id, label, api_key, provider_specific_data, quota_window_thresholds_json, priority)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      providerId,
      label,
      encrypt(apiKey),
      extra.providerSpecificData ?? null,
      extra.quotaWindowThresholds ?? null,
      extra.priority ?? 100
    );
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

export function updateConnection(
  id: number,
  patch: Partial<{
    label: string;
    apiKey: string;
    priority: number;
    enabled: boolean;
    providerSpecificData: string | null;
    quotaWindowThresholds: string | null;
  }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.label !== undefined) {
    sets.push("label = ?");
    params.push(patch.label);
  }
  if (patch.apiKey !== undefined) {
    sets.push("api_key = ?");
    params.push(encrypt(patch.apiKey));
  }
  if (patch.priority !== undefined) {
    sets.push("priority = ?");
    params.push(patch.priority);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.providerSpecificData !== undefined) {
    sets.push("provider_specific_data = ?");
    params.push(patch.providerSpecificData);
  }
  if (patch.quotaWindowThresholds !== undefined) {
    sets.push("quota_window_thresholds_json = ?");
    params.push(patch.quotaWindowThresholds);
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb()
    .prepare(`UPDATE connections SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

export function reorderConnections(orderedIds: number[]): void {
  const db = getDb();
  const setPriority = db.prepare("UPDATE connections SET priority = ? WHERE id = ?");
  const applyAll = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => setPriority.run(index, id));
  });
  applyAll(orderedIds);
}

export function deleteConnection(id: number): void {
  getDb().prepare("DELETE FROM connections WHERE id = ?").run(id);
}

export function getConnectionById(id: number): Connection | null {
  const row = getDb().prepare("SELECT * FROM connections WHERE id = ?").get(id) as
    ConnectionRow | undefined;
  return row ? toConnection(row) : null;
}

export function getConnectionByProviderAndLabel(
  providerId: string,
  label: string
): Connection | null {
  const row = getDb()
    .prepare("SELECT * FROM connections WHERE provider_id = ? AND label = ?")
    .get(providerId, label) as ConnectionRow | undefined;
  return row ? toConnection(row) : null;
}
