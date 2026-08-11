// tests/unit/db-lorebook-vars.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createLorebook } = await import("../../src/lib/db/lorebooks.ts");
const { getLorebookVar, setLorebookVar, listLorebookVars, sweepStaleLorebookVars } =
  await import("../../src/lib/db/lorebookVars.ts");

let lorebookId: number;

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM lorebook_vars").run();
  getDb().prepare("DELETE FROM lorebooks").run();
  lorebookId = createLorebook("a", "return null;");
});

test("setLorebookVar then getLorebookVar round-trips", () => {
  setLorebookVar(lorebookId, "card-hash-1", "visited_tavern", "true");
  assert.equal(getLorebookVar(lorebookId, "card-hash-1", "visited_tavern"), "true");
});

test("getLorebookVar returns null for an unset key", () => {
  assert.equal(getLorebookVar(lorebookId, "card-hash-1", "unset"), null);
});

test("setLorebookVar on an existing key updates the value, not appends a row", () => {
  setLorebookVar(lorebookId, "s1", "k1", "v1");
  setLorebookVar(lorebookId, "s1", "k1", "v2");
  assert.equal(getLorebookVar(lorebookId, "s1", "k1"), "v2");
  const rows = getDb()
    .prepare("SELECT COUNT(*) as n FROM lorebook_vars WHERE lorebook_id = ?")
    .get(lorebookId) as { n: number };
  assert.equal(rows.n, 1, "must be one row per key, not one row per write");
});

test("two different scope keys under the same lorebook do not collide", () => {
  setLorebookVar(lorebookId, "character-A-hash", "met_npc", "true");
  setLorebookVar(lorebookId, "character-B-hash", "met_npc", "false");
  assert.equal(getLorebookVar(lorebookId, "character-A-hash", "met_npc"), "true");
  assert.equal(getLorebookVar(lorebookId, "character-B-hash", "met_npc"), "false");
});

test("listLorebookVars returns every var for one scope as a plain map", () => {
  setLorebookVar(lorebookId, "s1", "a", "1");
  setLorebookVar(lorebookId, "s1", "b", "2");
  setLorebookVar(lorebookId, "s2", "a", "999");
  assert.deepEqual(listLorebookVars(lorebookId, "s1"), { a: "1", b: "2" });
});

test("setLorebookVar bumps last_used_at on every write, including updates", () => {
  setLorebookVar(lorebookId, "s1", "k1", "v1");
  const first = (
    getDb()
      .prepare(
        "SELECT last_used_at FROM lorebook_vars WHERE lorebook_id = ? AND scope_key = ? AND var_key = ?"
      )
      .get(lorebookId, "s1", "k1") as { last_used_at: number }
  ).last_used_at;
  const later = first + 10_000;
  setLorebookVar(lorebookId, "s1", "k1", "v2", later);
  const second = (
    getDb()
      .prepare(
        "SELECT last_used_at FROM lorebook_vars WHERE lorebook_id = ? AND scope_key = ? AND var_key = ?"
      )
      .get(lorebookId, "s1", "k1") as { last_used_at: number }
  ).last_used_at;
  assert.equal(second, later);
});

test("sweepStaleLorebookVars deletes rows untouched since the cutoff and returns the count", () => {
  setLorebookVar(lorebookId, "s1", "old", "v", 1000);
  setLorebookVar(lorebookId, "s1", "fresh", "v", Date.now());
  const deleted = sweepStaleLorebookVars(Date.now() - 1000);
  assert.equal(deleted, 1);
  assert.equal(getLorebookVar(lorebookId, "s1", "old"), null);
  assert.equal(getLorebookVar(lorebookId, "s1", "fresh"), "v");
});

test("deleting the parent lorebook cascades to its vars", async () => {
  setLorebookVar(lorebookId, "s1", "k1", "v1");
  const { deleteLorebook } = await import("../../src/lib/db/lorebooks.ts");
  deleteLorebook(lorebookId);
  const rows = getDb().prepare("SELECT * FROM lorebook_vars WHERE lorebook_id = ?").all(lorebookId);
  assert.equal(rows.length, 0);
});
