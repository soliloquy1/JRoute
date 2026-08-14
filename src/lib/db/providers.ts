// src/lib/db/providers.ts
import { getDb } from "./bootstrap.ts";
import { seedDefaultModels } from "./models.ts";
import type { Provider, ProviderKind, WireFormat } from "./types.ts";

interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  wire_format: string;
  enabled: number;
  model_prefix: string;
}

function toProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderKind,
    baseUrl: row.base_url,
    wireFormat: row.wire_format as WireFormat,
    enabled: row.enabled !== 0,
    modelPrefix: row.model_prefix ?? "",
  };
}

/**
 * A non-empty model prefix must be unique across providers — it is the routing key
 * that binds a `prefix/nativeId` request to exactly one provider. Returns the id of
 * the provider already using `prefix` (other than `exceptId`), or null if free.
 */
export function prefixOwner(prefix: string, exceptId?: string): string | null {
  if (!prefix) return null;
  const row = getDb()
    .prepare("SELECT id FROM providers WHERE model_prefix = ? AND id != ? LIMIT 1")
    .get(prefix, exceptId ?? "") as { id: string } | undefined;
  return row ? row.id : null;
}

export function listProviders(): Provider[] {
  const rows = getDb().prepare("SELECT * FROM providers ORDER BY id").all() as ProviderRow[];
  return rows.map(toProvider);
}

export function getProvider(id: string): Provider | null {
  const row = getDb().prepare("SELECT * FROM providers WHERE id = ?").get(id) as
    ProviderRow | undefined;
  return row ? toProvider(row) : null;
}

export function getProviderByPrefix(prefix: string): Provider | null {
  if (!prefix) return null;
  const row = getDb().prepare("SELECT * FROM providers WHERE model_prefix = ?").get(prefix) as
    ProviderRow | undefined;
  return row ? toProvider(row) : null;
}

export function deleteProvider(id: string): void {
  getDb().prepare("DELETE FROM providers WHERE id = ?").run(id);
}

export function upsertProvider(p: Provider): void {
  if (p.modelPrefix) {
    const owner = prefixOwner(p.modelPrefix, p.id);
    if (owner) {
      throw new Error(`Model prefix "${p.modelPrefix}" is already used by provider "${owner}"`);
    }
  }
  getDb()
    .prepare(
      `INSERT INTO providers (id, name, kind, base_url, wire_format, enabled, model_prefix)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         base_url = excluded.base_url,
         wire_format = excluded.wire_format,
         enabled = excluded.enabled,
         model_prefix = excluded.model_prefix`
    )
    .run(p.id, p.name, p.kind, p.baseUrl, p.wireFormat, p.enabled ? 1 : 0, p.modelPrefix ?? "");
  // Keep legacy convenience: a freshly added default provider (openai/anthropic/google)
  // automatically gets its well-known models, just like the old static MODEL_MAP.
  seedDefaultModels();
}
