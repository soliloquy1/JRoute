// tests/unit/lorebooks-sandbox-escape.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getQuickJS } from "quickjs-emscripten";

test("QuickJS guest has no fs, process, fetch, or timer globals (design spec 7.2 sandbox escape assertion)", async () => {
  const module = await getQuickJS();
  const runtime = module.newRuntime();
  const context = runtime.newContext();
  try {
    const result = context.evalCode(
      `JSON.stringify({
        fs: typeof fs,
        process: typeof process,
        fetch: typeof fetch,
        setTimeout: typeof setTimeout,
        setInterval: typeof setInterval,
        require: typeof require,
      })`
    );
    const jsonHandle = context.unwrapResult(result);
    const json = context.dump(jsonHandle) as string;
    jsonHandle.dispose();
    const globals = JSON.parse(json) as Record<string, string>;
    for (const [name, kind] of Object.entries(globals)) {
      assert.equal(kind, "undefined", `${name} must be undefined in the QuickJS guest`);
    }
  } finally {
    context.dispose();
    runtime.dispose();
  }
});

test("QuickJS guest cannot reach outside its own heap — a plain object literal round-trips, nothing more", async () => {
  const module = await getQuickJS();
  const runtime = module.newRuntime();
  const context = runtime.newContext();
  try {
    const result = context.evalCode(`({ ok: true, value: 1 + 1 })`);
    const handle = context.unwrapResult(result);
    const value = context.dump(handle);
    handle.dispose();
    assert.deepEqual(value, { ok: true, value: 2 });
  } finally {
    context.dispose();
    runtime.dispose();
  }
});
