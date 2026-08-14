// src/lib/db/models.ts
import { getDb } from "./bootstrap.ts";
import { getProvider, getProviderByPrefix } from "./providers.ts";

/**
 * Operator-editable, provider-scoped model catalog. Replaces the static MODEL_MAP:
 * every model belongs to exactly one provider (provider_id, model_id), so a model
 * routes only to that provider. The client requests a model as `prefix/nativeId`
 * (prefix is the provider's model_prefix) or, for legacy providers with an empty
 * prefix, just the native id.
 */

export interface Model {
  providerId: string;
  modelId: string;
  /** Client-facing id: `prefix/nativeId` when the provider has a prefix, else native. */
  clientId: string;
  maxTokens: number;
  enabled: boolean;
}

export interface ResolvedClientModel {
  providerId: string;
  /** Native model id sent upstream (no prefix). */
  nativeModel: string;
  maxTokens: number;
  prefix: string;
}

interface ModelRow {
  provider_id: string;
  model_id: string;
  max_tokens: number;
  enabled: number;
}

/** The deferred Plan 7 defaults — seeded once so legacy bare model ids keep working. */
export const DEFAULT_MODELS: Array<{ providerId: string; modelId: string; maxTokens: number }> = [
  { providerId: "anthropic", modelId: "claude-sonnet-4-6", maxTokens: 64000 },
  { providerId: "anthropic", modelId: "claude-opus-4-8", maxTokens: 32000 },
  { providerId: "anthropic", modelId: "claude-haiku-4-5", maxTokens: 32000 },
  { providerId: "openai", modelId: "gpt-4o", maxTokens: 16384 },
  { providerId: "openai", modelId: "gpt-4o-mini", maxTokens: 16384 },
  { providerId: "google", modelId: "gemini-2.0-flash", maxTokens: 8192 },
];

function toModel(row: ModelRow, prefix: string): Model {
  return {
    providerId: row.provider_id,
    modelId: row.model_id,
    clientId: prefix ? `${prefix}/${row.model_id}` : row.model_id,
    maxTokens: row.max_tokens,
    enabled: row.enabled !== 0,
  };
}

export function listModels(providerId?: string): Model[] {
  let rows: ModelRow[];
  if (providerId !== undefined) {
    rows = getDb()
      .prepare(
        `SELECT provider_id, model_id, max_tokens, enabled
         FROM models WHERE provider_id = ?
         ORDER BY model_id`
      )
      .all(providerId) as ModelRow[];
  } else {
    rows = getDb()
      .prepare(
        `SELECT provider_id, model_id, max_tokens, enabled
         FROM models ORDER BY provider_id, model_id`
      )
      .all() as ModelRow[];
  }
  return rows.map((row) => {
    const provider = getProvider(row.provider_id);
    return toModel(row, provider?.modelPrefix ?? "");
  });
}

export function getModel(providerId: string, modelId: string): Model | null {
  const row = getDb()
    .prepare(
      `SELECT provider_id, model_id, max_tokens, enabled FROM models
       WHERE provider_id = ? AND model_id = ?`
    )
    .get(providerId, modelId) as ModelRow | undefined;
  if (!row) return null;
  const provider = getProvider(providerId);
  return toModel(row, provider?.modelPrefix ?? "");
}

export function modelExists(providerId: string, modelId: string): boolean {
  return (
    getDb()
      .prepare("SELECT 1 FROM models WHERE provider_id = ? AND model_id = ?")
      .get(providerId, modelId) !== undefined
  );
}

export function createModel(
  providerId: string,
  modelId: string,
  maxTokens = 8192,
  enabled = true
): Model {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO models (provider_id, model_id, max_tokens, enabled)
       VALUES (?, ?, ?, ?)`
    )
    .run(providerId, modelId, maxTokens, enabled ? 1 : 0);
  return getModel(providerId, modelId) as Model;
}

export function updateModel(
  providerId: string,
  modelId: string,
  patch: Partial<{ maxTokens: number; enabled: boolean }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.maxTokens !== undefined) {
    sets.push("max_tokens = ?");
    params.push(patch.maxTokens);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }
  if (sets.length === 0) return;
  params.push(providerId, modelId);
  getDb()
    .prepare(`UPDATE models SET ${sets.join(", ")} WHERE provider_id = ? AND model_id = ?`)
    .run(...params);
}

export function deleteModel(providerId: string, modelId: string): void {
  getDb()
    .prepare("DELETE FROM models WHERE provider_id = ? AND model_id = ?")
    .run(providerId, modelId);
}

/** Bulk insert, ignoring duplicates (idempotent re-imports). */
export function importModels(
  providerId: string,
  items: Array<{ id: string; maxTokens?: number }>
): number {
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO models (provider_id, model_id, max_tokens, enabled)
     VALUES (?, ?, ?, 1)`
  );
  const tx = getDb().transaction((rows: Array<{ id: string; maxTokens: number }>) => {
    let count = 0;
    for (const r of rows) {
      const info = insert.run(providerId, r.id, r.maxTokens);
      if (info.changes > 0) count += 1;
    }
    return count;
  });
  const rows = items
    .filter((i) => i.id && !i.id.includes("/"))
    .map((i) => ({ id: i.id, maxTokens: i.maxTokens ?? 8192 }));
  if (rows.length === 0) return 0;
  return tx(rows);
}

/**
 * Resolves a client-supplied model string to its provider + native id.
 * - `prefix/nativeId`: prefix → provider, then confirm the native model exists there.
 * - bare id: legacy lookup against empty-prefix providers.
 * Returns null if unknown, the provider is missing/disabled, or the model is absent/disabled.
 */
export function resolveClientModel(clientModel: string): ResolvedClientModel | null {
  const slash = clientModel.indexOf("/");
  if (slash !== -1) {
    const prefix = clientModel.slice(0, slash);
    const native = clientModel.slice(slash + 1);
    if (!prefix || !native) return null;
    const provider = getProviderByPrefix(prefix);
    if (!provider || !provider.enabled) return null;
    const model = getModel(provider.id, native);
    if (!model || !model.enabled) return null;
    return { providerId: provider.id, nativeModel: native, maxTokens: model.maxTokens, prefix };
  }
  const row = getDb()
    .prepare(
      `SELECT m.provider_id AS provider_id, m.model_id AS model_id, m.max_tokens AS max_tokens
       FROM models m
       JOIN providers p ON p.id = m.provider_id
       WHERE m.model_id = ? AND m.enabled = 1 AND p.model_prefix = '' AND p.enabled = 1
       LIMIT 1`
    )
    .get(clientModel) as { provider_id: string; model_id: string; max_tokens: number } | undefined;
  if (!row) return null;
  return { providerId: row.provider_id, nativeModel: row.model_id, maxTokens: row.max_tokens, prefix: "" };
}

/** Seed the legacy defaults once (idempotent). Only seeds a model if its provider exists. */
export function seedDefaultModels(): void {
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO models (provider_id, model_id, max_tokens, enabled)
     VALUES (?, ?, ?, 1)`
  );
  for (const m of DEFAULT_MODELS) {
    if (!getProvider(m.providerId)) continue;
    insert.run(m.providerId, m.modelId, m.maxTokens);
  }
}
