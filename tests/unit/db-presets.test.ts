// tests/unit/db-presets.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createPreset, getPreset, updatePreset } = await import("../../src/lib/db/presets.ts");
const { createPromptBlock } = await import("../../src/lib/db/promptBlocks.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("updatePreset updates only the fields provided", () => {
  const id = createPreset("original-name", { toolMode: "off" });
  updatePreset(id, { name: "renamed" });
  const preset = getPreset(id);
  assert.equal(preset?.name, "renamed");
  assert.equal(preset?.toolMode, "off");
});

test("updatePreset can set prependBlockId, appendBlockId, and toolMode together", () => {
  const id = createPreset("p");
  const prependId = createPromptBlock("prep", "prepend", "system text");
  const appendId = createPromptBlock("app", "append", "trailing text");
  updatePreset(id, { prependBlockId: prependId, appendBlockId: appendId, toolMode: "trigger" });
  const preset = getPreset(id);
  assert.equal(preset?.prependBlockId, prependId);
  assert.equal(preset?.appendBlockId, appendId);
  assert.equal(preset?.toolMode, "trigger");
});

test("updatePreset can clear prependBlockId back to null", () => {
  const prependId = createPromptBlock("prep2", "prepend", "x");
  const id = createPreset("p2", { prependBlockId: prependId });
  updatePreset(id, { prependBlockId: null });
  assert.equal(getPreset(id)?.prependBlockId, null);
});

test("updatePreset with an empty patch is a no-op", () => {
  const id = createPreset("p3");
  updatePreset(id, {});
  assert.equal(getPreset(id)?.name, "p3");
});
