// tests/unit/migration-014-regex-presets.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

test("migration 014 creates regex_presets and api_keys.regex_preset_id", async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jroute-migration-014-"));
  process.env.DATA_DIR = tmpDir;
  const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
  const db = getDb();
  const tableRow = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='regex_presets'")
    .get() as { name?: string } | undefined;
  assert.equal(tableRow?.name, "regex_presets");
  const columns = db.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>;
  assert.ok(columns.some((c) => c.name === "regex_preset_id"));
  resetDb();
  rmSync(tmpDir, { recursive: true, force: true });
});
