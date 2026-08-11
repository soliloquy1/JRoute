// tests/unit/lorebooks-sandbox.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  runLorebook,
  DEFAULT_LIMITS,
  warmUpSandbox,
  buildLorebookCtx,
} from "../../src/lib/lorebooks/sandbox.ts";
import { getQuickJS } from "quickjs-emscripten";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-lorebook-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);
const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createLorebook } = await import("../../src/lib/db/lorebooks.ts");

const testLorebookId = createLorebook("test-lb", "function activate() {}");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

await warmUpSandbox();

test("a lorebook that returns null yields inactive, not an error", () => {
  const outcome = runLorebook("null", () => {});
  assert.deepEqual(outcome, { kind: "inactive" });
});

test("a lorebook that returns a value yields ok with the dumped result", () => {
  const outcome = runLorebook('function activate() { return "hello"; }', () => {});
  assert.deepEqual(outcome, { kind: "ok", result: "hello" });
});

test("a syntax error never throws, yields a kind:error outcome", () => {
  const outcome = runLorebook("this is not valid js {{{", () => {});
  assert.equal(outcome.kind, "error");
});

test("a runtime throw inside the lorebook never propagates, yields kind:error", () => {
  const outcome = runLorebook('throw new Error("boom")', () => {});
  assert.equal(outcome.kind, "error");
});

test("an infinite loop is killed by the wall-clock limit, never hangs the test", () => {
  const outcome = runLorebook("while (true) {}", () => {}, {
    wallClockMs: 20,
    maxInterruptTicks: 10_000_000,
  });
  assert.equal(outcome.kind, "error");
  if (outcome.kind === "error") {
    assert.match(outcome.reason, /interrupt|timeout|abort/i);
  }
});

test("exceeding the memory limit is killed, not a host crash", () => {
  const outcome = runLorebook('let s = "x"; while (true) { s = s + s; }', () => {}, {
    memoryLimitBytes: 64 * 1024,
    wallClockMs: 2000,
  });
  assert.equal(outcome.kind, "error");
});

test("DEFAULT_LIMITS matches the design spec's per-invocation caps", () => {
  assert.equal(DEFAULT_LIMITS.memoryLimitBytes, 16 * 1024 * 1024);
  assert.equal(DEFAULT_LIMITS.wallClockMs, 50);
});

test("the instruction-tick proxy alone (wall clock generous) still kills a tight loop", () => {
  const outcome = runLorebook("while (true) {}", () => {}, {
    wallClockMs: 60_000,
    maxInterruptTicks: 100,
  });
  assert.equal(outcome.kind, "error");
});

test("a newRuntime failure inside runLorebook yields kind:error, never a thrown exception", async (t) => {
  // getQuickJS() is memoized to a process-wide singleton inside quickjs-emscripten, so this
  // resolves to the exact same QuickJSWASMModule instance runLorebook already warmed up via
  // warmUpSandbox() above — mocking newRuntime on it reaches the sandbox's internal
  // `cachedModule` without needing sandbox.ts to expose any test-only hook. t.mock is scoped to
  // this test and restores the original newRuntime automatically once the test finishes, even
  // if an assertion below throws, so later tests in this file always see the real QuickJS module.
  const realModule = await getQuickJS();
  t.mock.method(realModule, "newRuntime", () => {
    throw new Error("simulated newRuntime failure");
  });

  const outcome = runLorebook("function activate() { return 1; }", () => {});
  assert.deepEqual(outcome, { kind: "error", reason: "simulated newRuntime failure" });
});

const baseCtx = () =>
  buildLorebookCtx({
    messages: [
      { role: "user", content: "hello there" },
      { role: "model", content: "greetings" },
      { role: "user", content: "the tavern is nice" },
    ],
    lastUserMessage: "the tavern is nice",
    characterName: "Ada",
    lorebookId: testLorebookId,
    scopeKey: "test-scope",
  });

test("ctx.lastUserMessage is available directly, no marshalling needed", () => {
  const outcome = runLorebook("function activate(ctx) { return ctx.lastUserMessage; }", baseCtx());
  assert.deepEqual(outcome, { kind: "ok", result: "the tavern is nice" });
});

test("ctx.characterName round-trips", () => {
  const outcome = runLorebook("function activate(ctx) { return ctx.characterName; }", baseCtx());
  assert.deepEqual(outcome, { kind: "ok", result: "Ada" });
});

test("ctx.messageCount and ctx.getMessage(i) marshal one message at a time", () => {
  const outcome = runLorebook(
    "function activate(ctx) { return JSON.stringify({ count: ctx.messageCount, first: ctx.getMessage(0), last: ctx.getMessage(ctx.messageCount - 1) }); }",
    baseCtx()
  );
  assert.equal(outcome.kind, "ok");
  if (outcome.kind === "ok") {
    const parsed = JSON.parse(outcome.result as string);
    assert.equal(parsed.count, 3);
    assert.deepEqual(parsed.first, { role: "user", content: "hello there" });
    assert.deepEqual(parsed.last, { role: "user", content: "the tavern is nice" });
  }
});

test("ctx.getMessage(i) out of range returns null, not a crash", () => {
  const outcome = runLorebook("function activate(ctx) { return ctx.getMessage(999); }", baseCtx());
  assert.deepEqual(outcome, { kind: "inactive" });
});

test("ctx.match returns true for a matching pattern against lastUserMessage", () => {
  const outcome = runLorebook(
    'function activate(ctx) { return ctx.match("\\\\b(tavern|inn)\\\\b"); }',
    baseCtx()
  );
  assert.deepEqual(outcome, { kind: "ok", result: true });
});

test("ctx.match returns false for a non-matching pattern", () => {
  const outcome = runLorebook(
    'function activate(ctx) { return ctx.match("\\\\bdungeon\\\\b"); }',
    baseCtx()
  );
  assert.deepEqual(outcome, { kind: "ok", result: false });
});

test("ctx.match rejects a catastrophic-backtracking pattern without hanging (design spec 7.2)", () => {
  const ReDoSCtx = buildLorebookCtx({
    messages: [],
    lastUserMessage: "a".repeat(30) + "X",
    characterName: "Ada",
    lorebookId: testLorebookId,
    scopeKey: "test-scope",
  });
  const outcome = runLorebook('function activate(ctx) { return ctx.match("(a+)+$"); }', ReDoSCtx);
  assert.deepEqual(outcome, { kind: "ok", result: false });
});

test("ctx.vars.set persists a value, readable in a later invocation with the same scopeKey", () => {
  const write = runLorebook(
    'function activate(ctx) { ctx.vars.set("visited", "true"); return "done"; }',
    baseCtx()
  );
  assert.deepEqual(write, { kind: "ok", result: "done" });
  const read = runLorebook('function activate(ctx) { return ctx.vars.get("visited"); }', baseCtx());
  assert.deepEqual(read, { kind: "ok", result: "true" });
});

test("ctx.vars.get returns null for an unset key, not undefined or a throw", () => {
  const outcome = runLorebook(
    'function activate(ctx) { return ctx.vars.get("never-set-key"); }',
    baseCtx()
  );
  assert.deepEqual(outcome, { kind: "inactive" });
});

test("ctx.vars.set persists a value at exactly the 64KB cap", () => {
  const ctx = buildLorebookCtx({
    messages: [],
    lastUserMessage: "",
    characterName: "",
    lorebookId: testLorebookId,
    scopeKey: "cap-scope-at-limit",
  });
  const atCap = "x".repeat(64 * 1024);
  const write = runLorebook(
    'function activate(ctx) { ctx.vars.set("k", __VALUE__); return "done"; }'.replace(
      "__VALUE__",
      JSON.stringify(atCap)
    ),
    ctx
  );
  assert.deepEqual(write, { kind: "ok", result: "done" });

  const readCtx = buildLorebookCtx({
    messages: [],
    lastUserMessage: "",
    characterName: "",
    lorebookId: testLorebookId,
    scopeKey: "cap-scope-at-limit",
  });
  const read = runLorebook('function activate(ctx) { return ctx.vars.get("k"); }', readCtx);
  assert.deepEqual(read, { kind: "ok", result: atCap });
});

test("ctx.vars.set over the 64KB cap is silently rejected, not persisted or truncated (design spec 7.2)", () => {
  const ctx = buildLorebookCtx({
    messages: [],
    lastUserMessage: "",
    characterName: "",
    lorebookId: testLorebookId,
    scopeKey: "cap-scope-over-limit",
  });
  const overCap = "x".repeat(64 * 1024 + 1);
  const write = runLorebook(
    'function activate(ctx) { ctx.vars.set("k", __VALUE__); return "done"; }'.replace(
      "__VALUE__",
      JSON.stringify(overCap)
    ),
    ctx
  );
  // ctx.vars.set() never throws, so the guest script runs to completion regardless.
  assert.deepEqual(write, { kind: "ok", result: "done" });

  const readCtx = buildLorebookCtx({
    messages: [],
    lastUserMessage: "",
    characterName: "",
    lorebookId: testLorebookId,
    scopeKey: "cap-scope-over-limit",
  });
  const read = runLorebook('function activate(ctx) { return ctx.vars.get("k"); }', readCtx);
  assert.deepEqual(read, { kind: "inactive" });
});

test("ctx.vars is isolated per scopeKey", () => {
  const ctxA = buildLorebookCtx({
    messages: [],
    lastUserMessage: "",
    characterName: "",
    lorebookId: testLorebookId,
    scopeKey: "scope-a",
  });
  const ctxB = buildLorebookCtx({
    messages: [],
    lastUserMessage: "",
    characterName: "",
    lorebookId: testLorebookId,
    scopeKey: "scope-b",
  });
  runLorebook('function activate(ctx) { ctx.vars.set("k", "from-a"); }', ctxA);
  const readFromB = runLorebook('function activate(ctx) { return ctx.vars.get("k"); }', ctxB);
  assert.deepEqual(readFromB, { kind: "inactive" });
});
