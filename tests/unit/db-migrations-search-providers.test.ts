// tests/unit/db-migrations-search-providers.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-migration-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("search_providers table exists with expected columns", () => {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(search_providers)").all() as { name: string }[];
  const names = cols.map((c) => c.name).sort();
  assert.deepEqual(names, ["api_key", "config_json", "created_at", "id", "kind", "label"].sort());
});

test("a builtin JRoute Web Search mcp_servers row is seeded, disabled by default", () => {
  const row = getDb().prepare("SELECT * FROM mcp_servers WHERE transport = 'builtin'").get() as
    { name: string; enabled: number; tool_allowlist: string; target: string } | undefined;
  assert.ok(row, "expected a seeded builtin row");
  assert.equal(row!.name, "JRoute Web Search");
  assert.equal(row!.enabled, 0);
  assert.equal(row!.tool_allowlist, "web_search,web_fetch");
});
