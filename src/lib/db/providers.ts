// src/lib/db/providers.ts
import { getDb } from "./bootstrap.ts";
import { seedDefaultModels } from "./models.ts";
import { CATALOG_PROVIDERS } from "../catalog/providers.ts";
import type { Provider, ProviderKind, WireFormat } from "./types.ts";

interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  wire_format: string;
  enabled: number;
  model_prefix: string;
  oauth_provider: string | null;
  provider_specific_data: string | null;
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
    oauthProvider: row.oauth_provider ?? null,
    providerSpecificData: row.provider_specific_data ?? null,
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
  const isNew = !getProvider(p.id);
  try {
    getDb()
      .prepare(
        `INSERT INTO providers (id, name, kind, base_url, wire_format, enabled, model_prefix, oauth_provider, provider_specific_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            kind = excluded.kind,
            base_url = excluded.base_url,
            wire_format = excluded.wire_format,
            enabled = excluded.enabled,
            model_prefix = excluded.model_prefix,
            oauth_provider = excluded.oauth_provider,
            provider_specific_data = excluded.provider_specific_data`
      )
      .run(
        p.id,
        p.name,
        p.kind,
        p.baseUrl,
        p.wireFormat,
        p.enabled ? 1 : 0,
        p.modelPrefix ?? "",
        p.oauthProvider ?? null,
        p.providerSpecificData ?? null
      );
  } catch (e) {
    // Backstop for the prefixOwner() check above: that check-then-insert is not atomic,
    // so a concurrent writer can still race past it. The unique index (migration 006) is
    // the real guarantee; translate its constraint violation into the same error shape.
    if (e instanceof Error && /UNIQUE constraint failed.*model_prefix/.test(e.message)) {
      throw new Error(`Model prefix "${p.modelPrefix}" is already used by another provider`);
    }
    throw e;
  }
  // Keep legacy convenience: a freshly added default provider (openai/anthropic/google)
  // automatically gets its well-known models, just like the old static MODEL_MAP. Only
  // on creation — an edit to an existing provider (e.g. changing its prefix) shouldn't
  // re-run the full default-seed scan on every save.
  if (isNew) seedDefaultModels();
}

/**
 * Seed the curated provider catalog into the `providers` table on first boot.
 * Uses INSERT OR IGNORE on the provider id so operator-created/edited rows are
 * never overwritten on subsequent boots (mirrors seedDefaultModels()'s idempotency).
 * Only shippable catalog entries (those with a concrete wireFormat) are seeded —
 * deferred OAuth providers are documented but intentionally not created as dead rows.
 */
export function seedCatalogProviders(): void {
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO providers
        (id, name, kind, base_url, wire_format, enabled, model_prefix, oauth_provider, provider_specific_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = getDb().transaction(() => {
    for (const c of CATALOG_PROVIDERS) {
      if (!c.wireFormat) continue; // deferred — skip
      insert.run(
        c.id,
        c.name,
        c.kind,
        c.baseUrl,
        c.wireFormat,
        1,
        c.modelPrefix ?? "",
        c.oauthProvider ?? null,
        c.providerSpecificDefaults ? JSON.stringify(c.providerSpecificDefaults) : null
      );
    }
    // The well-known providers (openai/anthropic/google) are now pre-seeded above,
    // so a later `upsertProvider({id:"openai"})` sees isNew === false and skips its
    // own seedDefaultModels() call. Seed their legacy default models here so the
    // catalog is immediately usable and tests that upsert a default provider still
    // get their models. Idempotent (INSERT OR IGNORE, provider-existence gated).
    seedDefaultModels();
  });
  tx();
}
