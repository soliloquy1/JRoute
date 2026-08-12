#!/usr/bin/env node
// bin/jroute.js
//
// CLI entry point. `next dev`/`next build` resolve their project root from `cwd`, so every
// invocation below explicitly sets `cwd: packageRoot` and spawns the package's own local
// `next` binary — that makes `jroute` work correctly from any directory once installed
// globally (`npm install -g jroute` or `npm link`), not just from inside the checkout.
//
// `start` does NOT use `next start`. next.config.mjs sets `output: "standalone"`, and
// `next start` explicitly does not support that mode — it starts (misleadingly, with only
// a warning, not an error) but serves a broken app: static chunks 404 and routes that read
// build-time output manifests fail (`/healthz` returns 503 with `next start` against a
// standalone build; confirmed directly, not from the Next.js docs alone). The correct way
// to run a standalone build is `node <distDir>/standalone/server.js`, which is a
// self-contained server bundle — but `next build` does not copy `public/` or the built
// static assets into that bundle for you (a known, deliberate Next.js behavior, not a bug);
// `ensureStandaloneAssets()` below does that copy, idempotently, before every `start`.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const [rawCommand, ...rest] = process.argv.slice(2);
const knownCommands = new Set(["start", "dev", "build"]);
const command = knownCommands.has(rawCommand) ? rawCommand : "start";
const passthroughArgs = knownCommands.has(rawCommand) ? rest : process.argv.slice(2);

function runNext(nextArgs) {
  const env = { ...process.env };
  if (!env.PORT) env.PORT = "20128";
  const child = spawn(nextBin, nextArgs, { cwd: packageRoot, stdio: "inherit", env });
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
  const env = { ...process.env };
  if (!env.PORT) env.PORT = "20128";
  const child = spawn(process.execPath, [standaloneServer], {
    cwd: packageRoot,
    stdio: "inherit",
    env,
  });
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
