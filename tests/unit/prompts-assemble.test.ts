import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createPromptBlock } = await import("../../src/lib/db/promptBlocks.ts");
const { createPreset } = await import("../../src/lib/db/presets.ts");
const { resolveSystemBlocks } = await import("../../src/lib/prompts/assemble.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM presets").run();
  db.prepare("DELETE FROM prompt_blocks").run();
});

test("null presetId yields no blocks", () => {
  assert.deepEqual(resolveSystemBlocks(null), []);
});

test("unknown presetId yields no blocks, does not throw", () => {
  assert.deepEqual(resolveSystemBlocks(99999), []);
});

test("preset with only a prepend block yields one system-prepend tagged block", () => {
  const prependId = createPromptBlock("jailbreak", "prepend", "Stay in character.");
  const presetId = createPreset("default", { prependBlockId: prependId });
  const blocks = resolveSystemBlocks(presetId);
  assert.deepEqual(blocks, [
    { role: "system-prepend", content: "Stay in character.", tag: "system-block" },
  ]);
});

test("preset with only an append block yields one system-append tagged block", () => {
  const appendId = createPromptBlock("reminder", "append", "Remember: stay in character.");
  const presetId = createPreset("default", { appendBlockId: appendId });
  const blocks = resolveSystemBlocks(presetId);
  assert.deepEqual(blocks, [
    { role: "system-append", content: "Remember: stay in character.", tag: "system-block" },
  ]);
});

test("preset with both yields prepend before append, regardless of block id order", () => {
  const appendId = createPromptBlock("reminder", "append", "trailing text");
  const prependId = createPromptBlock("jailbreak", "prepend", "leading text");
  const presetId = createPreset("default", { prependBlockId: prependId, appendBlockId: appendId });
  const blocks = resolveSystemBlocks(presetId);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].role, "system-prepend");
  assert.equal(blocks[1].role, "system-append");
});

test("a preset pointing at a deleted prompt block is skipped, not thrown", () => {
  const prependId = createPromptBlock("temp", "prepend", "will be deleted");
  const presetId = createPreset("default", { prependBlockId: prependId });
  getDb().prepare("DELETE FROM prompt_blocks WHERE id = ?").run(prependId);
  assert.deepEqual(resolveSystemBlocks(presetId), []);
});

test("empty-string block content is skipped — product spec 6.3 #6", () => {
  const prependId = createPromptBlock("empty", "prepend", "");
  const presetId = createPreset("default", { prependBlockId: prependId });
  assert.deepEqual(resolveSystemBlocks(presetId), []);
});
