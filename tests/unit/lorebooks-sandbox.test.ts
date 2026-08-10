// tests/unit/lorebooks-sandbox.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runLorebook, DEFAULT_LIMITS, warmUpSandbox } from "../../src/lib/lorebooks/sandbox.ts";

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
