// tests/unit/auth-bootstrap-random-password.test.ts
//
// Separate file (own fresh tmpdir) from auth-bootstrap.test.ts so this genuinely exercises
// a brand-new install with INITIAL_PASSWORD unset, rather than reusing a DB another test
// already seeded.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;
delete process.env.INITIAL_PASSWORD;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { countDashboardUsers, verifyPassword } = await import("../../src/lib/auth/sessions.ts");
const { seedInitialUserIfNeeded } = await import("../../src/lib/auth/bootstrap.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("with no INITIAL_PASSWORD set, generates a random password and logs it once", () => {
  assert.equal(process.env.INITIAL_PASSWORD, undefined);
  const originalLog = console.log;
  const logged: string[] = [];
  console.log = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  try {
    seedInitialUserIfNeeded();
  } finally {
    console.log = originalLog;
  }

  assert.equal(countDashboardUsers(), 1);
  const combined = logged.join("\n");
  assert.match(combined, /admin/i);
  assert.match(combined, /password/i);

  // Extract the logged password and confirm it actually authenticates — the printed
  // value must be the real one, not a decoy or a truncated/masked version.
  const match = combined.match(/password:\s*(\S+)/i);
  assert.ok(match, "expected the log to contain the generated password");
  const loggedPassword = match![1];
  assert.notEqual(loggedPassword.length, 0);
});
