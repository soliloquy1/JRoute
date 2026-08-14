// src/lib/db/logitBiasPresets.ts
import { getDb } from "./bootstrap.ts";
import { LogitBiasEntriesSchema, clampBiasValue } from "../prompts/logitBiasSchema.ts";
import type { LogitBiasEntry } from "../prompts/logitBiasSchema.ts";
import type { LogitBiasPreset } from "./types.ts";

interface LogitBiasPresetRow {
  id: number;
  name: string;
  entries: string;
  created_at: number;
}

// Validates the list AND its per-entry shape here rather than trusting callers: the API
// routes enforce the same cap, but a direct DB write (scripts, other modules) must not be
// able to store a preset the request path would then have to encode per request.
function parseAndClampEntries(entries: LogitBiasEntry[]): LogitBiasEntry[] {
  return LogitBiasEntriesSchema.parse(entries).map((parsed) => ({
    text: parsed.text,
    value: clampBiasValue(parsed.value),
  }));
}

function toLogitBiasPreset(row: LogitBiasPresetRow): LogitBiasPreset {
  return {
    id: row.id,
    name: row.name,
    entries: JSON.parse(row.entries) as LogitBiasEntry[],
    createdAt: row.created_at,
  };
}

export function createLogitBiasPreset(name: string, entries: LogitBiasEntry[]): number {
  const clamped = parseAndClampEntries(entries);
  const info = getDb()
    .prepare(`INSERT INTO logit_bias_presets (name, entries, created_at) VALUES (?, ?, ?)`)
    .run(name, JSON.stringify(clamped), Date.now());
  return Number(info.lastInsertRowid);
}

export function getLogitBiasPreset(id: number): LogitBiasPreset | null {
  const row = getDb().prepare("SELECT * FROM logit_bias_presets WHERE id = ?").get(id) as
    LogitBiasPresetRow | undefined;
  return row ? toLogitBiasPreset(row) : null;
}

export function listLogitBiasPresets(): LogitBiasPreset[] {
  const rows = getDb()
    .prepare("SELECT * FROM logit_bias_presets ORDER BY id")
    .all() as LogitBiasPresetRow[];
  return rows.map(toLogitBiasPreset);
}

export function updateLogitBiasPreset(
  id: number,
  patch: Partial<{ name: string; entries: LogitBiasEntry[] }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name);
  }
  if (patch.entries !== undefined) {
    sets.push("entries = ?");
    params.push(JSON.stringify(parseAndClampEntries(patch.entries)));
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb()
    .prepare(`UPDATE logit_bias_presets SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

export function deleteLogitBiasPreset(id: number): void {
  getDb().prepare("DELETE FROM logit_bias_presets WHERE id = ?").run(id);
}
