// tests/unit/db-lorebooks.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createLorebook, getLorebook, listLorebooks, updateLorebook, deleteLorebook } =
  await import("../../src/lib/db/lorebooks.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM lorebooks").run();
});

test("createLorebook defaults to enabled and character scope", () => {
  const id = createLorebook("tavern-lore", "function activate(ctx) { return null; }");
  const lb = getLorebook(id);
  assert.equal(lb?.enabled, true);
  assert.equal(lb?.scope, "character");
  assert.equal(lb?.triggerConfig, null);
});

test("createLorebook accepts scope and triggerConfig overrides", () => {
  const id = createLorebook("global-prefs", "return null;", {
    scope: "global",
    triggerConfig: '{"keywords":["tavern"]}',
  });
  const lb = getLorebook(id);
  assert.equal(lb?.scope, "global");
  assert.equal(lb?.triggerConfig, '{"keywords":["tavern"]}');
});

test("listLorebooks returns every row", () => {
  createLorebook("a", "return null;");
  createLorebook("b", "return null;");
  assert.equal(listLorebooks().length, 2);
});

test("updateLorebook can disable without touching source", () => {
  const id = createLorebook("a", "return null;");
  updateLorebook(id, { enabled: false });
  const lb = getLorebook(id);
  assert.equal(lb?.enabled, false);
  assert.equal(lb?.source, "return null;");
});

test("deleteLorebook removes the row", () => {
  const id = createLorebook("a", "return null;");
  deleteLorebook(id);
  assert.equal(getLorebook(id), null);
});

test("an invalid scope value is rejected by the CHECK constraint", () => {
  assert.throws(() => {
    getDb()
      .prepare("INSERT INTO lorebooks (name, source, scope, created_at) VALUES (?, ?, ?, ?)")
      .run("bad", "return null;", "chat", Date.now());
  }, /CHECK constraint failed/);
});
