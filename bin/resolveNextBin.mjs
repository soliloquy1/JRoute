// bin/resolveNextBin.mjs
//
// Resolve the absolute path to Next.js's CLI entry point.
//
// We deliberately DO NOT launch `node_modules/.bin/next`: on Windows that file is a POSIX
// shell script (with no `.cmd` shim) that `child_process.spawn` cannot execute directly, so
// the CLI would fail to start on Windows. Next's package `bin` maps `next` →
// `./dist/bin/next` (a plain Node script), so spawning `process.execPath` (the current Node
// binary) against that JS file is identical in behaviour and works on every platform.
//
// Resolution goes through Node's module resolver from the package root so it keeps working
// regardless of whether npm hoisted `next` up a level (a global install commonly nests a
// package's dependencies under its own `node_modules/`, but hoisting can place `next` one
// directory higher).

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * @param {string} packageRoot - absolute path to the installed package root
 * @returns {string|null} absolute path to Next's CLI entry, or null if unresolvable
 */
export function resolveNextBin(packageRoot) {
  try {
    const requireFromPackage = createRequire(join(packageRoot, "package.json"));
    const nextPkg = requireFromPackage.resolve("next/package.json");
    return join(dirname(nextPkg), "dist", "bin", "next");
  } catch {
    return null;
  }
}
