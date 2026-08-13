// tests/unit/db-rich-presets.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "jroute-rich-presets-"));
  process.env.DATA_DIR = tmpDir;
});

after(async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  resetDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

const minimalRaw = {
  temperature: 1,
  prompts: [{ identifier: "main", name: "Main", role: "system", content: "hi" }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
};

test("createRichPreset + getRichPreset round-trip", async () => {
  const { createRichPreset, getRichPreset } = await import("../../src/lib/db/richPresets.ts");
  const id = createRichPreset("Izumi", minimalRaw, { charName: "Izumi", userName: "Anon" });
  const got = getRichPreset(id);
  assert.ok(got);
  assert.equal(got?.name, "Izumi");
  assert.equal(got?.charName, "Izumi");
  assert.equal(got?.raw.prompts[0].identifier, "main");
  assert.deepEqual(got?.lorebookIds, []);
});

test("createRichPreset rejects invalid raw JSON shape", async () => {
  const { createRichPreset } = await import("../../src/lib/db/richPresets.ts");
  assert.throws(() => createRichPreset("Bad", { prompts: [] } as never));
});

test("listRichPresets returns all, ordered by id", async () => {
  const { createRichPreset, listRichPresets } = await import("../../src/lib/db/richPresets.ts");
  const a = createRichPreset("A", minimalRaw);
  const b = createRichPreset("B", minimalRaw);
  const list = listRichPresets();
  const ids = list.map((p) => p.id);
  assert.ok(ids.indexOf(a) < ids.indexOf(b));
});

test("updateRichPreset re-validates raw on write", async () => {
  const { createRichPreset, updateRichPreset, getRichPreset } =
    await import("../../src/lib/db/richPresets.ts");
  const id = createRichPreset("C", minimalRaw);
  assert.throws(() => updateRichPreset(id, { raw: { prompts: [] } as never }));
  updateRichPreset(id, { charName: "NewName" });
  assert.equal(getRichPreset(id)?.charName, "NewName");
});

test("setRichPresetLorebooks replaces membership, not additive", async () => {
  const { createRichPreset, setRichPresetLorebooks, getRichPreset } =
    await import("../../src/lib/db/richPresets.ts");
  const { createLorebook } = await import("../../src/lib/db/lorebooks.ts");
  const id = createRichPreset("D", minimalRaw);
  const l1 = createLorebook("L1", "() => null");
  const l2 = createLorebook("L2", "() => null");
  setRichPresetLorebooks(id, [l1, l2]);
  assert.deepEqual(
    getRichPreset(id)?.lorebookIds,
    [l1, l2].sort((a, b) => a - b)
  );
  setRichPresetLorebooks(id, [l2]);
  assert.deepEqual(getRichPreset(id)?.lorebookIds, [l2]);
});

test("deleteRichPreset removes the row", async () => {
  const { createRichPreset, deleteRichPreset, getRichPreset } =
    await import("../../src/lib/db/richPresets.ts");
  const id = createRichPreset("E", minimalRaw);
  deleteRichPreset(id);
  assert.equal(getRichPreset(id), null);
});
