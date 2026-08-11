// src/lib/db/presets.ts
import { getDb } from "./bootstrap.ts";
import type { Preset, ToolMode } from "./types.ts";

interface PresetRow {
  id: number;
  name: string;
  prepend_block_id: number | null;
  append_block_id: number | null;
  tool_mode: string;
  created_at: number;
}

function lorebookIdsFor(presetId: number): number[] {
  const rows = getDb()
    .prepare("SELECT lorebook_id FROM preset_lorebooks WHERE preset_id = ? ORDER BY lorebook_id")
    .all(presetId) as Array<{ lorebook_id: number }>;
  return rows.map((r) => r.lorebook_id);
}

function toPreset(row: PresetRow): Preset {
  return {
    id: row.id,
    name: row.name,
    prependBlockId: row.prepend_block_id,
    appendBlockId: row.append_block_id,
    toolMode: row.tool_mode as ToolMode,
    createdAt: row.created_at,
    lorebookIds: lorebookIdsFor(row.id),
  };
}

export function createPreset(
  name: string,
  opts: Partial<{ prependBlockId: number; appendBlockId: number; toolMode: ToolMode }> = {}
): number {
  const info = getDb()
    .prepare(
      `INSERT INTO presets (name, prepend_block_id, append_block_id, tool_mode, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      name,
      opts.prependBlockId ?? null,
      opts.appendBlockId ?? null,
      opts.toolMode ?? "off",
      Date.now()
    );
  return Number(info.lastInsertRowid);
}

export function getPreset(id: number): Preset | null {
  const row = getDb().prepare("SELECT * FROM presets WHERE id = ?").get(id) as
    PresetRow | undefined;
  return row ? toPreset(row) : null;
}

export function listPresets(): Preset[] {
  const rows = getDb().prepare("SELECT * FROM presets ORDER BY id").all() as PresetRow[];
  return rows.map(toPreset);
}

/**
 * Replaces the full lorebook membership set for a preset — not additive.
 * IMMEDIATE (not the default DEFERRED) takes the write lock up front so a
 * concurrent writer sees SQLITE_BUSY (retried by busy_timeout) rather than
 * SQLITE_BUSY_SNAPSHOT (which busy_timeout does not retry) — same reasoning
 * as lorebookVars.ts.
 */
export function setPresetLorebooks(presetId: number, lorebookIds: number[]): void {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare("DELETE FROM preset_lorebooks WHERE preset_id = ?").run(presetId);
    const insert = db.prepare(
      "INSERT INTO preset_lorebooks (preset_id, lorebook_id) VALUES (?, ?)"
    );
    for (const lorebookId of lorebookIds) {
      insert.run(presetId, lorebookId);
    }
  });
  run.immediate();
}

export function deletePreset(id: number): void {
  getDb().prepare("DELETE FROM presets WHERE id = ?").run(id);
}
