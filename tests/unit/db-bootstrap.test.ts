import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("creates the database with WAL and busy_timeout", () => {
  const db = getDb();
  assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(db.pragma("busy_timeout", { simple: true }), 2000);
});

test("migration 001 creates every table", () => {
  const db = getDb();
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
    name: string;
  }>;
  const names = new Set(rows.map((r) => r.name));
  for (const t of [
    "providers",
    "connections",
    "api_keys",
    "dashboard_users",
    "sessions",
    "usage_logs",
  ]) {
    assert.ok(names.has(t), `missing table ${t}`);
  }
});

test("getDb returns the same singleton", () => {
  assert.equal(getDb(), getDb());
});
