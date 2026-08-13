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

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(packageRoot, "node_modules", ".bin", "next");
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

// `--no-open` is stripped before command detection, not left for `next dev`/`start`'s own
// arg parsing to trip over, and not counted against `start`'s "no passthrough flags" rule.
const rawArgs = process.argv.slice(2);
const shouldOpenBrowser = !rawArgs.includes("--no-open");
const filteredArgs = rawArgs.filter((a) => a !== "--no-open");

const [rawCommand, ...rest] = filteredArgs;
const knownCommands = new Set(["start", "dev", "build"]);
const command = knownCommands.has(rawCommand) ? rawCommand : "start";
const passthroughArgs = knownCommands.has(rawCommand) ? rest : filteredArgs;

/**
 * Polls /healthz until it reports ready (see src/instrumentation.ts — this is the exact
 * signal that fixed /healthz always returning 503), then opens the default browser.
 * Fire-and-forget: never awaited by the caller, and every failure is swallowed — a
 * headless environment with no browser, or the server never coming up, must not crash or
 * hang the CLI. Bounded at 60s so a server that never becomes healthy doesn't poll forever.
 */
async function openBrowserWhenReady() {
  const url = `http://localhost:${port}/`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/healthz`);
      if (res.ok) {
        await open(url);
        return;
      }
    } catch {
      // Not up yet (or already gone) — keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function runNext(nextArgs) {
  const env = { ...process.env, PORT: port };
  const child = spawn(nextBin, nextArgs, { cwd: packageRoot, stdio: "inherit", env });
  if (shouldOpenBrowser) openBrowserWhenReady().catch(() => {});
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  child.on("error", (err) => {
    console.error(`[jroute] failed to launch Next.js: ${err.message}`);
    process.exit(1);
  });
}

function buildSync() {
  console.log("[jroute] Building for production (this can take a while)...");
  const build = spawnSync(nextBin, ["build"], {
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
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  child.on("error", (err) => {
    console.error(`[jroute] failed to launch the production server: ${err.message}`);
    process.exit(1);
  });
}

if (!existsSync(nextBin)) {
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
