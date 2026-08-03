import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const DELETED = [
  "electron",
  "src/mitm",
  "src/domain",
  "src/lib/memory",
  "src/lib/combos",
  "src/lib/compression",
  "src/lib/skills",
  "open-sse",
];

const KEPT = [
  "src/lib/db/migrationRunner.ts",
  "src/lib/db/migrationRunner/extraDirs.ts",
  "src/lib/db/encryption.ts",
  "src/lib/db/adapters",
  "src/shared/utils/testProcess.ts",
  "jroute",
];

test("non-goal subsystems are deleted", () => {
  for (const path of DELETED) {
    assert.equal(existsSync(path), false, `${path} should be deleted`);
  }
});

test("load-bearing modules are kept", () => {
  for (const path of KEPT) {
    assert.equal(existsSync(path), true, `${path} should exist`);
  }
});
