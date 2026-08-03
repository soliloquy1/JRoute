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
const { seedInitialUser, verifyPassword, createSession, verifySession, destroySession } =
  await import("../../src/lib/auth/sessions.ts");

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
  assert.notEqual(row.token_hash, token);
});

test("expired session is rejected", () => {
  const token = createSession(1);
  // Expire all sessions (intentional — this test owns the only live session at this point).
  getDb()
    .prepare("UPDATE sessions SET expires_at = ?")
    .run(Date.now() - 1000);
  assert.equal(verifySession(token), null);
});
