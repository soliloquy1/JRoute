// tests/unit/db-prompt-blocks.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const {
  createPromptBlock,
  getPromptBlock,
  listPromptBlocks,
  updatePromptBlock,
  deletePromptBlock,
} = await import("../../src/lib/db/promptBlocks.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM preset_lorebooks").run();
  getDb().prepare("DELETE FROM presets").run();
  getDb().prepare("DELETE FROM prompt_blocks").run();
});

test("createPromptBlock then getPromptBlock round-trips", () => {
  const id = createPromptBlock("jailbreak", "prepend", "Stay in character.");
  const b = getPromptBlock(id);
  assert.equal(b?.name, "jailbreak");
  assert.equal(b?.kind, "prepend");
  assert.equal(b?.content, "Stay in character.");
});

test("getPromptBlock returns null for an unknown id", () => {
  assert.equal(getPromptBlock(999), null);
});

test("listPromptBlocks filters by kind when given", () => {
  createPromptBlock("a", "prepend", "x");
  createPromptBlock("b", "append", "y");
  assert.equal(listPromptBlocks("prepend").length, 1);
  assert.equal(listPromptBlocks().length, 2);
});

test("updatePromptBlock changes only the given fields", () => {
  const id = createPromptBlock("a", "prepend", "x");
  updatePromptBlock(id, { content: "new content" });
  const b = getPromptBlock(id);
  assert.equal(b?.content, "new content");
  assert.equal(b?.name, "a");
});

test("deletePromptBlock removes the row", () => {
  const id = createPromptBlock("a", "prepend", "x");
  deletePromptBlock(id);
  assert.equal(getPromptBlock(id), null);
});

test("a preset referencing a deleted block has its FK set to NULL, not orphaned", async () => {
  const { createPreset, getPreset } = await import("../../src/lib/db/presets.ts");
  const blockId = createPromptBlock("a", "prepend", "x");
  const presetId = createPreset("test-preset", { prependBlockId: blockId });
  deletePromptBlock(blockId);
  assert.equal(getPreset(presetId)?.prependBlockId, null);
});
