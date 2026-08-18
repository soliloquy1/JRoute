// src/lib/db/searchProviders.ts
import { getDb } from "./bootstrap.ts";
import { encrypt, decrypt, looksEncrypted } from "./encryption.ts";
import { getActiveSearchProviderId, setActiveSearchProviderId } from "./settings.ts";
import type { SearchProvider, SearchProviderKind } from "./types.ts";

interface SearchProviderRow {
  id: number;
  kind: string;
  label: string;
  api_key: string;
  config_json: string | null;
  created_at: number;
}

function toProvider(row: SearchProviderRow): SearchProvider {
  const apiKey = (decrypt(row.api_key) ?? null) as string | null;
  // decrypt() returns null both for a genuinely absent key and for a stored ciphertext it
  // could not open (rotated/lost STORAGE_ENCRYPTION_KEY, or a corrupted value). Only the
  // latter carries the `enc:v1:` prefix, so use it to tell the two apart instead of sending
  // an empty key upstream and getting a confusing blind 401. Mirrors connections.ts.
  const credentialDecryptFailed = looksEncrypted(row.api_key) && apiKey === null;

  if (credentialDecryptFailed) {
    // Never log the ciphertext or any part of the key — ids only.
    console.warn(
      `[searchProviders] Search provider id=${row.id} (kind=${row.kind}) has an encrypted ` +
        `api_key that could not be decrypted. STORAGE_ENCRYPTION_KEY may have changed or ` +
        `the stored value is corrupted.`
    );
  }

  return {
    id: row.id,
    kind: row.kind as SearchProviderKind,
    label: row.label,
    apiKey,
    credentialDecryptFailed,
    configJson: row.config_json,
    createdAt: row.created_at,
  };
}

export function createSearchProvider(
  kind: SearchProviderKind,
  label: string,
  apiKey: string,
  configJson?: string | null
): number {
  const info = getDb()
    .prepare(`INSERT INTO search_providers (kind, label, api_key, config_json) VALUES (?, ?, ?, ?)`)
    .run(kind, label, encrypt(apiKey), configJson ?? null);
  return Number(info.lastInsertRowid);
}

export function getSearchProvider(id: number): SearchProvider | null {
  const row = getDb().prepare("SELECT * FROM search_providers WHERE id = ?").get(id) as
    SearchProviderRow | undefined;
  return row ? toProvider(row) : null;
}

export function listSearchProviders(): SearchProvider[] {
  const rows = getDb()
    .prepare("SELECT * FROM search_providers ORDER BY id")
    .all() as SearchProviderRow[];
  return rows.map(toProvider);
}

export function updateSearchProvider(
  id: number,
  patch: Partial<{ label: string; apiKey: string; configJson: string | null }>
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
  if (patch.configJson !== undefined) {
    sets.push("config_json = ?");
    params.push(patch.configJson);
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb()
    .prepare(`UPDATE search_providers SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

/**
 * Deletes the provider and, if it was the active one, clears `activeSearchProviderId`.
 * Without that second step the setting keeps pointing at a row that no longer exists and
 * every `web_search` call fails with "configured search provider no longer exists" until an
 * operator resets it by hand.
 */
export function deleteSearchProvider(id: number): void {
  getDb().prepare("DELETE FROM search_providers WHERE id = ?").run(id);
  if (getActiveSearchProviderId() === id) setActiveSearchProviderId(null);
}
