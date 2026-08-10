// tests/unit/lorebooks-runner.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-runner-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createLorebook } = await import("../../src/lib/db/lorebooks.ts");
const { warmUpSandbox } = await import("../../src/lib/lorebooks/sandbox.ts");
const { runLorebooksForRequest } = await import("../../src/lib/lorebooks/runner.ts");

await warmUpSandbox();

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM lorebooks").run();
  getDb().prepare("DELETE FROM lorebook_vars").run();
});

const baseInput = (lorebookIds: number[]) => ({
  lorebookIds,
  messages: [{ role: "user", content: "tell me about the tavern" }],
  rawSystemPrompt: "Ada is a helpful robot.",
});

test("an empty lorebookIds list produces no blocks", () => {
  assert.deepEqual(runLorebooksForRequest(baseInput([])), []);
});

test("a lorebook returning null (inactive) produces no block", () => {
  const id = createLorebook("silent", "function activate(ctx) { return null; }");
  assert.deepEqual(runLorebooksForRequest(baseInput([id])), []);
});

test("a lorebook returning a string produces a depth-injection block at the default depth 2", () => {
  const id = createLorebook("greeter", 'function activate(ctx) { return "The tavern is warm."; }');
  const blocks = runLorebooksForRequest(baseInput([id]));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].tag, "depth-injection");
  if (blocks[0].tag === "depth-injection") {
    assert.equal(blocks[0].depth, 2);
    assert.equal(blocks[0].content, "The tavern is warm.");
  }
});

test("a lorebook returning {text, depth} produces a block at the specified depth", () => {
  const id = createLorebook(
    "precise",
    'function activate(ctx) { return { text: "Deep lore.", depth: 5 }; }'
  );
  const blocks = runLorebooksForRequest(baseInput([id]));
  assert.equal(blocks.length, 1);
  if (blocks[0].tag === "depth-injection") {
    assert.equal(blocks[0].depth, 5);
    assert.equal(blocks[0].content, "Deep lore.");
  }
});

test("a disabled lorebook is skipped even if its id is passed in", () => {
  const id = createLorebook("off", 'function activate(ctx) { return "should not appear"; }', {
    enabled: false,
  });
  assert.deepEqual(runLorebooksForRequest(baseInput([id])), []);
});

test("multiple lorebooks concatenate in registration (lorebookIds) order", () => {
  const idA = createLorebook("a", 'function activate(ctx) { return "from A"; }');
  const idB = createLorebook("b", 'function activate(ctx) { return "from B"; }');
  const blocks = runLorebooksForRequest(baseInput([idA, idB]));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].content, "from A");
  assert.equal(blocks[1].content, "from B");
});

test("a lorebook that throws is skipped, does not stop later lorebooks from running", () => {
  const idBad = createLorebook("broken", 'function activate(ctx) { throw new Error("boom"); }');
  const idGood = createLorebook("fine", 'function activate(ctx) { return "still works"; }');
  const blocks = runLorebooksForRequest(baseInput([idBad, idGood]));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].content, "still works");
});

test("a lorebook whose activate uses ctx.match sees the real last user message", () => {
  const id = createLorebook(
    "tavern",
    'function activate(ctx) { return ctx.match("\\\\btavern\\\\b") ? "Tavern lore." : null; }'
  );
  const blocks = runLorebooksForRequest(baseInput([id]));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].content, "Tavern lore.");
});

test("a lorebook returning a shape other than null/string/{text,depth} is treated as inactive, not a crash", () => {
  const id = createLorebook("weird", "function activate(ctx) { return 42; }");
  assert.deepEqual(runLorebooksForRequest(baseInput([id])), []);
});
