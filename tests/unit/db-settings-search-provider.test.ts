// tests/unit/db-settings-search-provider.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-settings-search-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { getActiveSearchProviderId, setActiveSearchProviderId } =
  await import("../../src/lib/db/settings.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM settings").run();
});

test("defaults to null when unset", () => {
  assert.equal(getActiveSearchProviderId(), null);
});

test("round-trips a set id", () => {
  setActiveSearchProviderId(42);
  assert.equal(getActiveSearchProviderId(), 42);
});

test("can be cleared back to null", () => {
  setActiveSearchProviderId(42);
  setActiveSearchProviderId(null);
  assert.equal(getActiveSearchProviderId(), null);
});
