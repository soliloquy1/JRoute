// tests/unit/support/triggerModeSpyLoader.mjs
//
// A Node.js module customization hook (https://nodejs.org/api/module.html#customization-hooks),
// used ONLY by tests/unit/handle-chat.test.ts, to prove that the trigger-mode gate
// (`key.toolMode === "trigger"` in jroute/handleChat.ts:101) actually controls whether
// `runTriggerMode` (src/lib/mcp/trigger.ts) gets invoked.
//
// Why not `node:test`'s `mock.module()`? It is the natural fit for "swap out one named
// export and count calls", but it requires the `--experimental-test-module-mocks` CLI flag
// (verified empirically against Node v25.6.1: `mock.module` is `undefined` without it, and
// the flag cannot be smuggled in via NODE_OPTIONS — Node rejects it there). This repo's test
// commands (`npm test`, `npm run test:unit`, and the exact verification command
// `node --import tsx/esm --test tests/unit/handle-chat.test.ts`) do not pass that flag, so a
// test relying on `mock.module()` would fail outside of a hand-crafted invocation.
//
// `module.register()` hooks need no such flag and ship unflagged in the same Node versions.
// This hook intercepts the specifier `jroute/handleChat.ts` resolves for trigger.ts and
// replaces it with a thin call-counting wrapper that DELEGATES to the real implementation
// (via the opaque `trigger-spy:real` specifier, resolved straight through to the real file via
// `nextLoad`). Behavior is therefore unchanged — including the real SSRF-rejected-unreachable-
// server path exercised by the "trigger-mode MCP result reaches..." test in the same file —
// only a call counter (`globalThis.__runTriggerModeCallCount`) is added.

const REAL_TRIGGER_URL = new URL("../../../src/lib/mcp/trigger.ts", import.meta.url).href;

function isTriggerSpecifier(specifier) {
  return specifier === REAL_TRIGGER_URL || specifier.endsWith("/src/lib/mcp/trigger.ts");
}

export async function resolve(specifier, context, nextResolve) {
  if (isTriggerSpecifier(specifier)) {
    return { url: "trigger-spy:wrapper", shortCircuit: true };
  }
  if (specifier === "trigger-spy:real") {
    // Resolve straight to the REAL file URL (not another opaque specifier). `load` below then
    // sees this exact `.ts` url like any other import and falls through to `nextLoad`, which
    // continues down the normal hook chain (tsx's loader transpiles it) — no special-casing
    // needed in `load`, which is what broke transpilation in an earlier version of this hook
    // (forcing/losing `format` context there fed raw TypeScript straight to V8).
    return { url: REAL_TRIGGER_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === "trigger-spy:wrapper") {
    const source = `
      import { runTriggerMode as __realRunTriggerMode } from "trigger-spy:real";
      export async function runTriggerMode(...args) {
        globalThis.__runTriggerModeCallCount = (globalThis.__runTriggerModeCallCount ?? 0) + 1;
        return __realRunTriggerMode(...args);
      }
    `;
    return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
