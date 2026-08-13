// tests/unit/auth-bootstrap.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { countDashboardUsers, verifyPassword, getDashboardUser } =
  await import("../../src/lib/auth/sessions.ts");
const { seedInitialUserIfNeeded } = await import("../../src/lib/auth/bootstrap.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("with no dashboard users and INITIAL_PASSWORD set, seeds admin with that password", async () => {
  process.env.INITIAL_PASSWORD = "operator-chosen-password";
  try {
    seedInitialUserIfNeeded();
  } finally {
    delete process.env.INITIAL_PASSWORD;
  }
  assert.equal(countDashboardUsers(), 1);
  const userId = await verifyPassword("admin", "operator-chosen-password");
  assert.ok(userId);
  assert.equal(getDashboardUser(userId!)?.mustChange, true);
});

test("running again with a user already present is a no-op, never overwrites", async () => {
  const before = countDashboardUsers();
  process.env.INITIAL_PASSWORD = "a-different-password";
  try {
    seedInitialUserIfNeeded();
  } finally {
    delete process.env.INITIAL_PASSWORD;
  }
  assert.equal(countDashboardUsers(), before);
  // The original password from the first test must still work — a second call must not
  // silently reset it.
  assert.ok(await verifyPassword("admin", "operator-chosen-password"));
});
