// src/lib/db/regexPresets.ts
import isSafeRegex from "safe-regex";
import { getDb } from "./bootstrap.ts";
import { RegexScriptsSchema, compileFindRegex } from "../prompts/regexScriptSchema.ts";
import type { RegexScript } from "../prompts/regexScriptSchema.ts";
import type { RegexPreset } from "./types.ts";

interface RegexPresetRow {
  id: number;
  name: string;
  scripts: string;
  created_at: number;
}

export class InvalidRegexScriptError extends Error {}

// Validated here (not just at the API route) so a direct DB write (scripts, other
// modules) cannot store a preset the request path would then have to defend against on
// every chat request — mirrors logitBiasPresets.ts's parseAndClampEntries.
function parseAndValidateScripts(scripts: RegexScript[]): RegexScript[] {
  const parsed = RegexScriptsSchema.parse(scripts);
  for (const script of parsed) {
    let compiled: RegExp;
    try {
      compiled = compileFindRegex(script.findRegex);
    } catch {
      throw new InvalidRegexScriptError(
        `Script "${script.scriptName}": findRegex does not compile`
      );
    }
    if (!isSafeRegex(compiled.source)) {
      throw new InvalidRegexScriptError(
        `Script "${script.scriptName}": findRegex is not a safe pattern (potential ReDoS)`
      );
    }
  }
  return parsed;
}

function toRegexPreset(row: RegexPresetRow): RegexPreset {
  return {
    id: row.id,
    name: row.name,
    scripts: JSON.parse(row.scripts) as RegexScript[],
    createdAt: row.created_at,
  };
}

export function createRegexPreset(name: string, scripts: RegexScript[]): number {
  const validated = parseAndValidateScripts(scripts);
  const info = getDb()
    .prepare(`INSERT INTO regex_presets (name, scripts, created_at) VALUES (?, ?, ?)`)
    .run(name, JSON.stringify(validated), Date.now());
  return Number(info.lastInsertRowid);
}

export function getRegexPreset(id: number): RegexPreset | null {
  const row = getDb().prepare("SELECT * FROM regex_presets WHERE id = ?").get(id) as
    RegexPresetRow | undefined;
  return row ? toRegexPreset(row) : null;
}

export function listRegexPresets(): RegexPreset[] {
  const rows = getDb()
    .prepare("SELECT * FROM regex_presets ORDER BY id")
    .all() as RegexPresetRow[];
  return rows.map(toRegexPreset);
}

export function updateRegexPreset(
  id: number,
  patch: Partial<{ name: string; scripts: RegexScript[] }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name);
  }
  if (patch.scripts !== undefined) {
    sets.push("scripts = ?");
    params.push(JSON.stringify(parseAndValidateScripts(patch.scripts)));
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb()
    .prepare(`UPDATE regex_presets SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

export function deleteRegexPreset(id: number): void {
  getDb().prepare("DELETE FROM regex_presets WHERE id = ?").run(id);
}
