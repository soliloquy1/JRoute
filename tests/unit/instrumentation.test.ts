// tests/unit/instrumentation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

const { getServerLifecyclePhase, markServerStarting } =
  await import("../../src/lib/serverLifecycle.ts");
const { register } = await import("../../src/instrumentation.ts");

test("register() marks the server ready when NEXT_RUNTIME is nodejs", async () => {
  markServerStarting();
  assert.equal(getServerLifecyclePhase(), "starting");
  process.env.NEXT_RUNTIME = "nodejs";
  try {
    await register();
    assert.equal(getServerLifecyclePhase(), "ready");
  } finally {
    delete process.env.NEXT_RUNTIME;
  }
});

test("register() does nothing outside the nodejs runtime (e.g. edge)", async () => {
  markServerStarting();
  assert.equal(getServerLifecyclePhase(), "starting");
  process.env.NEXT_RUNTIME = "edge";
  try {
    await register();
    assert.equal(getServerLifecyclePhase(), "starting");
  } finally {
    delete process.env.NEXT_RUNTIME;
  }
});
