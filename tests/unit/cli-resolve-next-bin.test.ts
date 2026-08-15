// tests/unit/cli-resolve-next-bin.test.ts
//
// Guards the Windows-compatibility fix: the CLI must resolve Next's real JS entry
// (node_modules/next/dist/bin/next) and never the POSIX-only node_modules/.bin/next shell
// script, which `child_process.spawn` cannot launch on Windows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveNextBin } from "../../bin/resolveNextBin.mjs";

const packageRoot = join(fileURLToPath(import.meta.url), "..", "..", "..");

test("resolves Next's JS CLI entry (not the .bin shell script)", () => {
  const nextBin = resolveNextBin(packageRoot);
  assert.ok(nextBin, "expected a resolvable Next.js entry");
  assert.ok(
    nextBin.endsWith(join("next", "dist", "bin", "next")),
    `expected path to end with next/dist/bin/next, got: ${nextBin}`
  );
  assert.ok(!nextBin.includes(join("node_modules", ".bin")), "must not be the .bin shim");
  assert.ok(existsSync(nextBin), `resolved file must exist: ${nextBin}`);
});

test("is robust to a non-existent package root (resolution walks up the tree)", () => {
  // createRequire resolves modules from the nearest ancestor node_modules, so a bogus root
  // still yields a valid path rather than throwing — the CLI must never crash on this path.
  const nextBin = resolveNextBin(join(packageRoot, "this-path-does-not-exist"));
  assert.ok(typeof nextBin === "string" && nextBin.length > 0);
  assert.ok(nextBin.endsWith(join("next", "dist", "bin", "next")));
});

test("returns null when next is genuinely unresolvable (no ancestor node_modules)", () => {
  // A temp dir has no node_modules among its ancestors, so resolution must fail cleanly to
  // null — this is the path guarded by `if (!nextBin)` in bin/jroute.js.
  const dir = mkdtempSync(join(tmpdir(), "jroute-resolve-test-"));
  try {
    assert.equal(resolveNextBin(dir), null);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup only
    }
  }
});
