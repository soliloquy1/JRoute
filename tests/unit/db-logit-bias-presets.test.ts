// tests/unit/db-logit-bias-presets.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "jroute-logit-bias-presets-"));
  process.env.DATA_DIR = tmpDir;
});

after(async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  resetDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("createLogitBiasPreset + getLogitBiasPreset round-trip", async () => {
  const { createLogitBiasPreset, getLogitBiasPreset } =
    await import("../../src/lib/db/logitBiasPresets.ts");
  const id = createLogitBiasPreset("No Suddenly", [{ text: "suddenly", value: -80 }]);
  const got = getLogitBiasPreset(id);
  assert.ok(got);
  assert.equal(got?.name, "No Suddenly");
  assert.deepEqual(got?.entries, [{ text: "suddenly", value: -80 }]);
});

test("createLogitBiasPreset clamps out-of-range values on write", async () => {
  const { createLogitBiasPreset, getLogitBiasPreset } =
    await import("../../src/lib/db/logitBiasPresets.ts");
  const id = createLogitBiasPreset("Extreme", [{ text: "x", value: 500 }]);
  assert.equal(getLogitBiasPreset(id)?.entries[0].value, 100);
});

test("createLogitBiasPreset rejects an entry with empty text", async () => {
  const { createLogitBiasPreset } = await import("../../src/lib/db/logitBiasPresets.ts");
  assert.throws(() => createLogitBiasPreset("Bad", [{ text: "", value: 0 } as never]));
});

test("createLogitBiasPreset rejects a duplicate name", async () => {
  const { createLogitBiasPreset } = await import("../../src/lib/db/logitBiasPresets.ts");
  createLogitBiasPreset("Dup", []);
  assert.throws(() => createLogitBiasPreset("Dup", []));
});

test("listLogitBiasPresets returns all, ordered by id", async () => {
  const { createLogitBiasPreset, listLogitBiasPresets } =
    await import("../../src/lib/db/logitBiasPresets.ts");
  const a = createLogitBiasPreset("A", []);
  const b = createLogitBiasPreset("B", []);
  const ids = listLogitBiasPresets().map((p) => p.id);
  assert.ok(ids.indexOf(a) < ids.indexOf(b));
});

test("updateLogitBiasPreset replaces entries and re-clamps", async () => {
  const { createLogitBiasPreset, updateLogitBiasPreset, getLogitBiasPreset } =
    await import("../../src/lib/db/logitBiasPresets.ts");
  const id = createLogitBiasPreset("E", [{ text: "a", value: 1 }]);
  updateLogitBiasPreset(id, { entries: [{ text: "b", value: -200 }] });
  const got = getLogitBiasPreset(id);
  assert.deepEqual(got?.entries, [{ text: "b", value: -100 }]);
});

test("updateLogitBiasPreset renames without touching entries", async () => {
  const { createLogitBiasPreset, updateLogitBiasPreset, getLogitBiasPreset } =
    await import("../../src/lib/db/logitBiasPresets.ts");
  const id = createLogitBiasPreset("F", [{ text: "a", value: 1 }]);
  updateLogitBiasPreset(id, { name: "F2" });
  const got = getLogitBiasPreset(id);
  assert.equal(got?.name, "F2");
  assert.deepEqual(got?.entries, [{ text: "a", value: 1 }]);
});

test("deleteLogitBiasPreset removes the row", async () => {
  const { createLogitBiasPreset, deleteLogitBiasPreset, getLogitBiasPreset } =
    await import("../../src/lib/db/logitBiasPresets.ts");
  const id = createLogitBiasPreset("G", []);
  deleteLogitBiasPreset(id);
  assert.equal(getLogitBiasPreset(id), null);
});

test("getLogitBiasPreset returns null for an unknown id", async () => {
  const { getLogitBiasPreset } = await import("../../src/lib/db/logitBiasPresets.ts");
  assert.equal(getLogitBiasPreset(999999), null);
});
