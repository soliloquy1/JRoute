// src/instrumentation.ts
//
// Next.js calls `register()` exactly once when a server instance starts (dev, `next
// start`, and the standalone server bundle all invoke it the same way). Marking the
// server ready here is what `/healthz` actually depends on:
// `getServerLifecyclePhase()` (src/lib/serverLifecycle.ts) defaults to "starting" and
// stays there forever unless something calls `markServerReady()` — nothing else in this
// codebase does, so `/healthz` returned 503 unconditionally until this hook existed
// (confirmed directly: dev, `next start`, and the standalone bundle all reproduced it).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { markServerReady } = await import("@/lib/serverLifecycle");
    markServerReady();
  }
}
