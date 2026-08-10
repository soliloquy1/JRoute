// src/lib/lorebooks/sandbox.ts
import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import type { QuickJSContext, QuickJSHandle, QuickJSWASMModule } from "quickjs-emscripten";

export interface SandboxLimits {
  memoryLimitBytes: number;
  maxInterruptTicks: number;
  wallClockMs: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  memoryLimitBytes: 16 * 1024 * 1024,
  maxInterruptTicks: 200_000,
  wallClockMs: 50,
};

export type LorebookOutcome =
  { kind: "ok"; result: unknown } | { kind: "inactive" } | { kind: "error"; reason: string };

/** A `ctx`-builder hook: given the live context and its global object handle, attach
 * whatever host functions/values the caller needs before `activate` is invoked. Kept as
 * an injection point so Task 3 owns the actual `ctx` shape and this file owns only the
 * runtime lifecycle and resource limits — a clean separation matching the design's own
 * split between "the sandbox" (§7.2) and "the ctx contract" (§7.1).
 */
export interface SandboxBridge {
  context: QuickJSContext;
  global: QuickJSHandle;
}

let modulePromise: Promise<QuickJSWASMModule> | null = null;

function loadModule(): Promise<QuickJSWASMModule> {
  if (!modulePromise) modulePromise = getQuickJS();
  return modulePromise;
}

/** Synchronous-looking API over an async module load: the module is memoized after the
 * first call, and every real caller (Task 5's runner, invoked from `handleChat`, which is
 * already `async`) can `await` it once per process lifetime effectively for free after
 * warmup. `runLorebook` itself stays synchronous per request — see the note below.
 */
let cachedModule: QuickJSWASMModule | null = null;

export async function warmUpSandbox(): Promise<void> {
  cachedModule = await loadModule();
}

/**
 * Runs one lorebook's `activate(ctx)` inside a resource-limited QuickJS context.
 *
 * NEVER throws — every failure mode (syntax error, runtime throw, timeout, memory cap,
 * instruction-budget proxy) is caught and returned as `{ kind: "error" }` per design spec
 * §7.2's "a lorebook exceeding any limit is disabled for the remainder of the request; the
 * error surfaces in the dashboard log" — the caller decides what "disabled" means (Task 5
 * skips it and logs), this function's contract is just "never crash the request."
 *
 * Requires `cachedModule` to be warm (call `warmUpSandbox()` once at process start, e.g.
 * from the server bootstrap). If it is not warm, this function returns a `kind: "error"`
 * outcome rather than blocking synchronously on an async load — a lorebook failing once
 * during cold start and succeeding on every subsequent request is an acceptable, visible
 * degradation; silently blocking the request pipeline on WASM instantiation is not.
 */
export function runLorebook(
  source: string,
  buildCtx: (bridge: SandboxBridge) => void,
  limitsOverride: Partial<SandboxLimits> = {}
): LorebookOutcome {
  if (!cachedModule) {
    return { kind: "error", reason: "sandbox not warmed up (call warmUpSandbox() at boot)" };
  }
  const limits = { ...DEFAULT_LIMITS, ...limitsOverride };

  let ticks = 0;
  const deadline = Date.now() + limits.wallClockMs;
  const deadlineHandler = shouldInterruptAfterDeadline(deadline);

  const runtime = cachedModule.newRuntime({
    memoryLimitBytes: limits.memoryLimitBytes,
    interruptHandler: (rt) => {
      ticks += 1;
      if (ticks > limits.maxInterruptTicks) return true;
      return deadlineHandler(rt);
    },
  });

  try {
    const context = runtime.newContext();
    try {
      buildCtx({ context, global: context.global });

      const wrapped = `(function activateWrapper(){ ${source}\n return typeof activate === "function" ? activate(typeof __ctx !== "undefined" ? __ctx : undefined) : null; })()`;
      const evalResult = context.evalCode(wrapped);

      let value: unknown;
      try {
        const handle = context.unwrapResult(evalResult);
        value = context.dump(handle);
        handle.dispose();
      } catch (err) {
        return { kind: "error", reason: err instanceof Error ? err.message : String(err) };
      }

      if (value === null || value === undefined) return { kind: "inactive" };
      return { kind: "ok", result: value };
    } finally {
      context.dispose();
    }
  } catch (err) {
    return { kind: "error", reason: err instanceof Error ? err.message : String(err) };
  } finally {
    runtime.dispose();
  }
}
