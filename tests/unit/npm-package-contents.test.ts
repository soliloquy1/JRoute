// tests/unit/npm-package-contents.test.ts
//
// Guards against a real regression: `src/instrumentation.ts` (the fix for `/healthz`
// permanently returning 503) was added without being added to `package.json`'s `files`
// whitelist, so a real `npm pack`/`npm publish` would have silently shipped a package
// that rebuilds without the fix — the in-repo test suite passed the whole time because
// it runs against the source tree, not the packaged artifact. `npm pack --dry-run`
// doesn't touch disk or the registry; it's read-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

interface PackedFile {
  path: string;
}

function packedFilePaths(): string[] {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
  });
  const [entry] = JSON.parse(output) as Array<{ files: PackedFile[] }>;
  return entry.files.map((f) => f.path);
}

test("npm package includes bin/jroute.js (the CLI entry point)", () => {
  const files = packedFilePaths();
  assert.ok(files.includes("bin/jroute.js"), "bin/jroute.js missing from packed files");
});

test("npm package includes src/instrumentation.ts (the /healthz readiness fix)", () => {
  const files = packedFilePaths();
  assert.ok(
    files.includes("src/instrumentation.ts"),
    "src/instrumentation.ts missing from packed files — /healthz would return 503 forever on a real install"
  );
});
