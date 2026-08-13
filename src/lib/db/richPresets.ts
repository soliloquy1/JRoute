// src/lib/db/richPresets.ts
import { getDb } from "./bootstrap.ts";
import { RichPresetJsonSchema } from "../prompts/stPresetSchema.ts";
import type { RichPreset } from "./types.ts";
import type { RichPresetJson } from "../prompts/stPresetSchema.ts";

interface RichPresetRow {
  id: number;
  name: string;
  raw_json: string;
  char_name: string;
  user_name: string;
  created_at: number;
}

function lorebookIdsFor(richPresetId: number): number[] {
  const rows = getDb()
    .prepare(
      "SELECT lorebook_id FROM rich_preset_lorebooks WHERE rich_preset_id = ? ORDER BY lorebook_id"
    )
    .all(richPresetId) as Array<{ lorebook_id: number }>;
  return rows.map((r) => r.lorebook_id);
}

function toRichPreset(row: RichPresetRow): RichPreset {
  return {
    id: row.id,
    name: row.name,
    raw: JSON.parse(row.raw_json) as RichPresetJson,
    charName: row.char_name,
    userName: row.user_name,
    createdAt: row.created_at,
    lorebookIds: lorebookIdsFor(row.id),
  };
}

export function createRichPreset(
  name: string,
  raw: unknown,
  opts: Partial<{ charName: string; userName: string }> = {}
): number {
  const parsed = RichPresetJsonSchema.parse(raw);
  const info = getDb()
    .prepare(
      `INSERT INTO rich_presets (name, raw_json, char_name, user_name, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, JSON.stringify(parsed), opts.charName ?? "", opts.userName ?? "", Date.now());
  return Number(info.lastInsertRowid);
}

export function getRichPreset(id: number): RichPreset | null {
  const row = getDb().prepare("SELECT * FROM rich_presets WHERE id = ?").get(id) as
    RichPresetRow | undefined;
  return row ? toRichPreset(row) : null;
}

export function listRichPresets(): RichPreset[] {
  const rows = getDb().prepare("SELECT * FROM rich_presets ORDER BY id").all() as RichPresetRow[];
  return rows.map(toRichPreset);
}

export function updateRichPreset(
  id: number,
  patch: Partial<{ name: string; raw: unknown; charName: string; userName: string }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name);
  }
  if (patch.raw !== undefined) {
    const parsed = RichPresetJsonSchema.parse(patch.raw);
    sets.push("raw_json = ?");
    params.push(JSON.stringify(parsed));
  }
  if (patch.charName !== undefined) {
    sets.push("char_name = ?");
    params.push(patch.charName);
  }
  if (patch.userName !== undefined) {
    sets.push("user_name = ?");
    params.push(patch.userName);
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb()
    .prepare(`UPDATE rich_presets SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

/**
 * Replaces the full lorebook membership set for a rich preset — not additive.
 * IMMEDIATE (not the default DEFERRED) for the same reason as `presets.ts`'s
 * `setPresetLorebooks`: a concurrent writer should see SQLITE_BUSY (retried by
 * busy_timeout) rather than SQLITE_BUSY_SNAPSHOT (which busy_timeout does not retry).
 */
export function setRichPresetLorebooks(richPresetId: number, lorebookIds: number[]): void {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare("DELETE FROM rich_preset_lorebooks WHERE rich_preset_id = ?").run(richPresetId);
    const insert = db.prepare(
      "INSERT INTO rich_preset_lorebooks (rich_preset_id, lorebook_id) VALUES (?, ?)"
    );
    for (const lorebookId of lorebookIds) {
      insert.run(richPresetId, lorebookId);
    }
  });
  run.immediate();
}

export function deleteRichPreset(id: number): void {
  getDb().prepare("DELETE FROM rich_presets WHERE id = ?").run(id);
}
