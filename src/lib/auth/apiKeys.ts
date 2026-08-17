// src/lib/auth/apiKeys.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "../db/bootstrap.ts";
import type { ApiKeyRecord, ToolMode } from "../db/types.ts";

interface ApiKeyRow {
  id: number;
  key_hash: string;
  label: string;
  preset_id: number | null;
  rich_preset_id: number | null;
  logit_bias_preset_id: number | null;
  regex_preset_id: number | null;
  tool_mode: string;
  rate_limit_per_min: number;
  created_at: number;
}

const KEY_PATTERN = /^jr-[0-9a-f]{64}$/;

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function toRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    keyHash: row.key_hash,
    label: row.label,
    presetId: row.preset_id,
    richPresetId: row.rich_preset_id,
    logitBiasPresetId: row.logit_bias_preset_id,
    regexPresetId: row.regex_preset_id,
    toolMode: row.tool_mode as ToolMode,
    rateLimitPerMin: row.rate_limit_per_min,
    createdAt: row.created_at,
  };
}

export function issueApiKey(
  label: string,
  toolMode: ToolMode = "off"
): {
  id: number;
  secret: string;
} {
  const secret = `jr-${randomBytes(32).toString("hex")}`;
  const info = getDb()
    .prepare("INSERT INTO api_keys (key_hash, label, tool_mode, created_at) VALUES (?, ?, ?, ?)")
    .run(hashKey(secret), label, toolMode, Date.now());
  return { id: Number(info.lastInsertRowid), secret };
}

export function verifyApiKey(raw: string): ApiKeyRecord | null {
  if (!KEY_PATTERN.test(raw)) return null;
  const candidate = hashKey(raw);
  const row = getDb().prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(candidate) as
    ApiKeyRow | undefined;
  if (!row) return null;
  // NOTE: this compare is a redundancy check, NOT the primary timing defense.
  // The row was fetched with `WHERE key_hash = ?` on `candidate`, so a returned
  // row's key_hash is already byte-identical to it and the false branch is
  // unreachable today. It is kept only to fail closed if the query above ever
  // changes to return partial/fuzzy matches.
  //
  // Key-existence timing is already observable regardless: an attacker learns
  // whether a key exists from whether the indexed lookup returns a row at all.
  // A constant-time compare after a lookup keyed on the secret-derived value
  // cannot hide that. Both are fixed-length hex digests, so lengths always
  // match here; the guard exists because timingSafeEqual throws on mismatch.
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(row.key_hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return toRecord(row);
}

export function revokeApiKey(id: number): void {
  getDb().prepare("DELETE FROM api_keys WHERE id = ?").run(id);
}

// Mutual exclusivity between presetId and richPresetId is enforced by each setter actively
// clearing the other column on every write (design spec §4) — simpler and more robust than a
// cross-field Zod refine, which would reject legitimate "clear A, set B" flows that send one
// field per call.
export function setApiKeyPreset(id: number, presetId: number | null): void {
  getDb()
    .prepare("UPDATE api_keys SET preset_id = ?, rich_preset_id = NULL WHERE id = ?")
    .run(presetId, id);
}

export function setApiKeyRichPreset(id: number, richPresetId: number | null): void {
  getDb()
    .prepare("UPDATE api_keys SET rich_preset_id = ?, preset_id = NULL WHERE id = ?")
    .run(richPresetId, id);
}

// Independent of presetId/richPresetId — a logit bias preset is an orthogonal dimension
// (spec §3), so this setter does NOT clear the other preset columns, unlike
// setApiKeyPreset/setApiKeyRichPreset above.
export function setApiKeyLogitBiasPreset(id: number, logitBiasPresetId: number | null): void {
  getDb()
    .prepare("UPDATE api_keys SET logit_bias_preset_id = ? WHERE id = ?")
    .run(logitBiasPresetId, id);
}

export function listApiKeys(): ApiKeyRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM api_keys ORDER BY created_at DESC")
    .all() as ApiKeyRow[];
  return rows.map(toRecord);
}
