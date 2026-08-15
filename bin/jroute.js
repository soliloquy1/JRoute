#!/usr/bin/env node
// bin/jroute.js
//
// CLI entry point. `next dev`/`next build` resolve their project root from `cwd`, so every
// invocation below explicitly sets `cwd: packageRoot` and spawns the package's own local
// `next` binary — that makes `jroute` work correctly from any directory once installed
// globally (`npm install -g jroute` or `npm link`), not just from inside the checkout.
//
// `start` does NOT use `next start`. next.config.mjs sets `output: "standalone"`, and
// `next start` prints a warning that it does not support that mode — it still boots and
// serves correctly (verified directly: with src/instrumentation.ts in place, `/healthz`
// and static assets both work fine under plain `next start` too; the 503/404s seen while
// building this were the missing instrumentation hook, not a `next start` defect). Running
// the standalone bundle directly avoids that warning and is the mode `output: "standalone"`
// is actually meant for — but doing so needs two things `next build` does not do for you:
// `next build` does not copy `public/` or the built static assets into the standalone
// bundle (a known, deliberate Next.js behavior, not a bug) — `ensureStandaloneAssets()`
// below does that copy, idempotently, before every `start`. See its sibling comment for
// the second thing (the CommonJS/ESM server.js issue).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { parseArgs } from "./parseArgs.mjs";
import { resolveNextBin } from "./resolveNextBin.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// Not `node_modules/.bin/next`: that's a POSIX shell script on Windows with no `.cmd` shim
// that spawn() can't launch. resolveNextBin() returns Next's real `dist/bin/next` JS entry
// (see bin/resolveNextBin.mjs) so the CLI runs identically on every platform.
const nextBin = resolveNextBin(packageRoot);
// Matches next.config.mjs's own default and its `NEXT_DIST_DIR` override — must be kept in
// relative form (not resolved against packageRoot) because the standalone server bundle
// mirrors this same relative path inside itself for its own static-asset lookup.
const distDirName = process.env.NEXT_DIST_DIR || ".build/next";
const distDir = join(packageRoot, distDirName);
const standaloneDir = join(distDir, "standalone");
// Next's generated server.js is CommonJS, but the standalone bundle also copies our own
// package.json (which has "type": "module") next to it — Node then parses server.js as
// ESM by extension+nearest-package.json rules and crashes on its `require(...)` calls
// (`ReferenceError: require is not defined in ES module scope`, confirmed directly). The
// `.cjs` extension forces CommonJS resolution regardless of the sibling package.json.
const standaloneServer = join(standaloneDir, "server.cjs");
const standaloneServerSrc = join(standaloneDir, "server.js");
const DEFAULT_PORT = "20128";
const port = process.env.PORT || DEFAULT_PORT;

const { shouldOpenBrowser, command, passthroughArgs } = parseArgs(process.argv.slice(2));

/**
 * Polls /healthz until it reports ready (see src/instrumentation.ts — this is the exact
 * signal that fixed /healthz always returning 503), then opens the default browser.
 * Fire-and-forget: never awaited by the caller, and every failure is swallowed — a
 * headless environment with no browser, or the server never coming up, must not crash or
 * hang the CLI. Bounded at 60s TOTAL, enforced per-attempt too (each health-check fetch
 * carries its own AbortSignal.timeout capped to the remaining budget) — otherwise a
 * connection that's accepted but never responds could keep one `fetch` call alive past the
 * documented 60s deadline, since Node's fetch has no short default timeout of its own.
 */
async function openBrowserWhenReady() {
  const url = `http://localhost:${port}/`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    let ready = false;
    try {
      const remainingMs = Math.max(deadline - Date.now(), 100);
      const res = await fetch(`http://localhost:${port}/healthz`, {
        signal: AbortSignal.timeout(Math.min(3000, remainingMs)),
      });
      ready = res.ok;
    } catch {
      // Not up yet, the probe itself timed out, or the server is already gone — keep
      // polling until the deadline.
    }
    if (ready) {
      try {
        await open(url);
      } catch {
        // No GUI available, or the browser couldn't be launched — nothing more to try.
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function runNext(nextArgs) {
  const env = { ...process.env, PORT: port };
  // Spawn the Node binary against Next's JS entry — cross-platform (see resolveNextBin).
  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd: packageRoot,
    stdio: "inherit",
    env,
  });
  if (shouldOpenBrowser) openBrowserWhenReady().catch(() => {});
  forwardChildExit(child, "[jroute] failed to launch Next.js");
}

function buildSync() {
  console.log("[jroute] Building for production (this can take a while)...");
  const build = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: packageRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (build.status !== 0) {
    console.error("[jroute] Build failed.");
    process.exit(build.status ?? 1);
  }
}

/** Idempotent — safe to call before every `start`, cheap when already in sync. */
function ensureStandaloneAssets() {
  const staticSrc = join(distDir, "static");
  const staticDest = join(standaloneDir, distDirName, "static");
  if (existsSync(staticSrc)) {
    cpSync(staticSrc, staticDest, { recursive: true });
  }
  const publicSrc = join(packageRoot, "public");
  if (existsSync(publicSrc)) {
    cpSync(publicSrc, join(standaloneDir, "public"), { recursive: true });
  }
  if (existsSync(standaloneServerSrc)) {
    cpSync(standaloneServerSrc, standaloneServer);
  }
}

function runStandaloneServer() {
  const env = { ...process.env, PORT: port };
  const child = spawn(process.execPath, [standaloneServer], {
    cwd: packageRoot,
    stdio: "inherit",
    env,
  });
  if (shouldOpenBrowser) openBrowserWhenReady().catch(() => {});
  forwardChildExit(child, "[jroute] failed to launch the production server");
}

/**
 * Replicate a child's exit onto this process. When the child died on a signal we re-deliver
 * that signal to ourselves so the CLI exits with the same code a direct invocation would
 * (e.g. 130 for SIGINT on Ctrl+C) — never a hardcoded 1. Windows only honors SIGINT/SIGTERM
 * for process.kill; any other signal either can't occur there or can't be forwarded, in which
 * case we fall back to a non-zero exit instead of crashing on an unsupported-signal throw.
 */
function forwardChildExit(child, errorPrefix) {
  child.on("exit", (code, signal) => {
    if (signal) {
      try {
        if (signal === "SIGINT" || signal === "SIGTERM") {
          process.kill(process.pid, signal);
          return;
        }
      } catch {
        // signal not supported on this platform — fall through to a clean non-zero exit
      }
      process.exit(1);
    } else {
      process.exit(code ?? 0);
    }
  });
  child.on("error", (err) => {
    console.error(`${errorPrefix}: ${err.message}`);
    process.exit(1);
  });
}

if (!nextBin || !existsSync(nextBin)) {
  console.error(
    "[jroute] Next.js is not installed in this package's node_modules. " +
      "Reinstall with `npm install` in the package directory."
  );
  process.exit(1);
}

switch (command) {
  case "build":
    buildSync();
    ensureStandaloneAssets();
    break;
  case "dev":
    runNext(["dev", ...passthroughArgs]);
    break;
  case "start": {
    if (passthroughArgs.length > 0) {
      console.error(
        "[jroute] `start` runs the standalone production server directly and does not " +
          "accept Next CLI flags. Set PORT/DATA_DIR as environment variables instead."
      );
      process.exit(1);
    }
    if (!existsSync(standaloneServerSrc)) buildSync();
    ensureStandaloneAssets();
    runStandaloneServer();
    break;
  }
}
