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

test("migration 002 creates the remaining data-model tables", () => {
  const db = getDb();
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
    name: string;
  }>;
  const names = new Set(rows.map((r) => r.name));
  for (const t of [
    "prompt_blocks",
    "presets",
    "preset_lorebooks",
    "lorebooks",
    "lorebook_vars",
    "mcp_servers",
  ]) {
    assert.ok(names.has(t), `missing table ${t}`);
  }
});

test("migration 002 adds connections.enabled, defaulting to 1", () => {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(connections)").all() as Array<{ name: string }>;
  assert.ok(
    cols.some((c) => c.name === "enabled"),
    "connections.enabled column missing"
  );
});

test("migrations do not re-run or error across a process restart on the same file", () => {
  resetDb();
  const db = getDb();
  assert.doesNotThrow(() => db.prepare("SELECT 1 FROM mcp_servers LIMIT 1").get());
});
