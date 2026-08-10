// tests/unit/db-presets.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createPreset, getPreset, listPresets, setPresetLorebooks, deletePreset } =
  await import("../../src/lib/db/presets.ts");
const { createLorebook } = await import("../../src/lib/db/lorebooks.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM preset_lorebooks").run();
  getDb().prepare("DELETE FROM presets").run();
  getDb().prepare("DELETE FROM lorebooks").run();
});

test("createPreset then getPreset round-trips with defaults", () => {
  const id = createPreset("default");
  const p = getPreset(id);
  assert.equal(p?.name, "default");
  assert.equal(p?.toolMode, "off");
  assert.equal(p?.prependBlockId, null);
  assert.deepEqual(p?.lorebookIds, []);
});

test("createPreset accepts tool mode and block ids", () => {
  const id = createPreset("with-tools", { toolMode: "native" });
  assert.equal(getPreset(id)?.toolMode, "native");
});

test("setPresetLorebooks replaces the full membership set", () => {
  const presetId = createPreset("p1");
  const lb1 = createLorebook("lb1", "return null;");
  const lb2 = createLorebook("lb2", "return null;");
  setPresetLorebooks(presetId, [lb1, lb2]);
  assert.deepEqual(getPreset(presetId)?.lorebookIds.sort(), [lb1, lb2].sort());
  setPresetLorebooks(presetId, [lb1]);
  assert.deepEqual(getPreset(presetId)?.lorebookIds, [lb1]);
});

test("listPresets returns every preset", () => {
  createPreset("a");
  createPreset("b");
  assert.equal(listPresets().length, 2);
});

test("deletePreset removes the row and its lorebook memberships", () => {
  const presetId = createPreset("p1");
  const lb1 = createLorebook("lb1", "return null;");
  setPresetLorebooks(presetId, [lb1]);
  deletePreset(presetId);
  assert.equal(getPreset(presetId), null);
  const orphans = getDb()
    .prepare("SELECT * FROM preset_lorebooks WHERE preset_id = ?")
    .all(presetId);
  assert.equal(orphans.length, 0);
});

test("a duplicate preset name is rejected by the UNIQUE constraint", () => {
  createPreset("shared-name");
  assert.throws(() => createPreset("shared-name"), /UNIQUE constraint failed/);
});
