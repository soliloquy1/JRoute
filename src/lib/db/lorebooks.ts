// src/lib/db/lorebooks.ts
import { getDb } from "./bootstrap.ts";
import type { Lorebook, LorebookScope } from "./types.ts";

interface LorebookRow {
  id: number;
  name: string;
  source: string;
  enabled: number;
  trigger_config: string | null;
  scope: string;
  created_at: number;
}

function toLorebook(row: LorebookRow): Lorebook {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    enabled: row.enabled !== 0,
    triggerConfig: row.trigger_config,
    scope: row.scope as LorebookScope,
    createdAt: row.created_at,
  };
}

export function createLorebook(
  name: string,
  source: string,
  opts: Partial<{ enabled: boolean; triggerConfig: string; scope: LorebookScope }> = {}
): number {
  const info = getDb()
    .prepare(
      `INSERT INTO lorebooks (name, source, enabled, trigger_config, scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      source,
      opts.enabled === false ? 0 : 1,
      opts.triggerConfig ?? null,
      opts.scope ?? "character",
      Date.now()
    );
  return Number(info.lastInsertRowid);
}

export function getLorebook(id: number): Lorebook | null {
  const row = getDb().prepare("SELECT * FROM lorebooks WHERE id = ?").get(id) as
    LorebookRow | undefined;
  return row ? toLorebook(row) : null;
}

export function listLorebooks(): Lorebook[] {
  const rows = getDb().prepare("SELECT * FROM lorebooks ORDER BY id").all() as LorebookRow[];
  return rows.map(toLorebook);
}

export function updateLorebook(
  id: number,
  patch: Partial<{
    name: string;
    source: string;
    enabled: boolean;
    triggerConfig: string | null;
    scope: LorebookScope;
  }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name);
  }
  if (patch.source !== undefined) {
    sets.push("source = ?");
    params.push(patch.source);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.triggerConfig !== undefined) {
    sets.push("trigger_config = ?");
    params.push(patch.triggerConfig);
  }
  if (patch.scope !== undefined) {
    sets.push("scope = ?");
    params.push(patch.scope);
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb()
    .prepare(`UPDATE lorebooks SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

export function deleteLorebook(id: number): void {
  getDb().prepare("DELETE FROM lorebooks WHERE id = ?").run(id);
}
