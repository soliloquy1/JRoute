// tests/unit/auth-sessions.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const {
  seedInitialUser,
  verifyPassword,
  createSession,
  verifySession,
  destroySession,
  getDashboardUser,
  countDashboardUsers,
  verifyCurrentPassword,
  changePassword,
} = await import("../../src/lib/auth/sessions.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("password verifies correctly and rejects a wrong one", async () => {
  const id = seedInitialUser("admin", "correct-horse");
  assert.equal(await verifyPassword("admin", "correct-horse"), id);
  assert.equal(await verifyPassword("admin", "wrong"), null);
  assert.equal(await verifyPassword("nobody", "correct-horse"), null);
});

test("password is not stored in plaintext", () => {
  const row = getDb()
    .prepare("SELECT password_hash FROM dashboard_users WHERE username = 'admin'")
    .get() as { password_hash: string };
  assert.notEqual(row.password_hash, "correct-horse");
  assert.match(row.password_hash, /^\$2[aby]\$/);
});

test("session round-trips and can be destroyed", () => {
  const token = createSession(1);
  assert.equal(verifySession(token), 1);
  destroySession(token);
  assert.equal(verifySession(token), null);
});

test("session token is not stored in plaintext", () => {
  const token = createSession(1);
  // Scope by token_hash to avoid returning an unrelated row when multiple sessions exist.
  const expectedHash = createHash("sha256").update(token).digest("hex");
  const row = getDb()
    .prepare("SELECT token_hash FROM sessions WHERE token_hash = ?")
    .get(expectedHash) as { token_hash: string };
  // Positive assertion: the stored value is specifically the SHA-256 digest, not merely
  // "something other than the token" (which any non-plaintext encoding would satisfy).
  assert.equal(row.token_hash, expectedHash);
  assert.notEqual(row.token_hash, token);
});

test("a freshly seeded user defaults to must_change = true", () => {
  const id = seedInitialUser("must-change-check", "whatever-pw");
  const user = getDashboardUser(id);
  assert.equal(user?.username, "must-change-check");
  assert.equal(user?.mustChange, true);
});

test("getDashboardUser returns null for a missing id", () => {
  assert.equal(getDashboardUser(999999), null);
});

test("countDashboardUsers reflects the real row count", () => {
  const before = countDashboardUsers();
  seedInitialUser("count-check-" + before, "pw");
  assert.equal(countDashboardUsers(), before + 1);
});

test("verifyCurrentPassword checks a specific user's password by id", async () => {
  const id = seedInitialUser("current-pw-check", "the-real-password");
  assert.equal(await verifyCurrentPassword(id, "the-real-password"), true);
  assert.equal(await verifyCurrentPassword(id, "wrong-password"), false);
  assert.equal(await verifyCurrentPassword(999999, "anything"), false);
});

test("changePassword updates the hash and clears must_change", async () => {
  const id = seedInitialUser("change-pw-check", "old-password");
  assert.equal(getDashboardUser(id)?.mustChange, true);

  changePassword(id, "new-password");

  assert.equal(getDashboardUser(id)?.mustChange, false);
  assert.equal(await verifyPassword("change-pw-check", "old-password"), null);
  assert.equal(await verifyPassword("change-pw-check", "new-password"), id);
});

test("expired session is rejected", () => {
  const token = createSession(1);
  // Expire ONLY this test's session. Earlier tests leave live sessions behind, so an
  // unscoped UPDATE would expire those too and the assertion would pass even if the
  // expiry check were wrong for this specific row.
  const expectedHash = createHash("sha256").update(token).digest("hex");
  getDb()
    .prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
    .run(Date.now() - 1000, expectedHash);
  assert.equal(verifySession(token), null);
});
