// tests/unit/migration-014-reasoning-tags.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("migration 014 adds rich_presets.reasoning_tags with a default of '[]'", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "jroute-migration-014-"));
  process.env.DATA_DIR = tmpDir;
  const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(rich_presets)").all() as Array<{
    name: string;
    dflt_value: string | null;
  }>;
  const col = columns.find((c) => c.name === "reasoning_tags");
  assert.ok(col, "reasoning_tags column must exist");
  assert.equal(col?.dflt_value, "'[]'");
  resetDb();
  rmSync(tmpDir, { recursive: true, force: true });
});
