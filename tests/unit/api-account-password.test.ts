// tests/unit/api-account-password.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession, getDashboardUser, verifyPassword } =
  await import("../../src/lib/auth/sessions.ts");
const passwordRoute = await import("../../src/app/api/account/password/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("PATCH /api/account/password without a session is 401", async () => {
  const res = await passwordRoute.PATCH(
    new Request("https://x/api/account/password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword: "a", newPassword: "new-password-123" }),
    })
  );
  assert.equal(res.status, 401);
});

test("PATCH with the wrong current password is rejected and does not change anything", async () => {
  const userId = seedInitialUser("pw-wrong-check", "the-real-password");
  const token = createSession(userId);
  const res = await passwordRoute.PATCH(
    new Request("https://x/api/account/password", {
      method: "PATCH",
      headers: { cookie: `jroute_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "totally-wrong", newPassword: "new-password-123" }),
    })
  );
  assert.equal(res.status, 401);
  assert.equal(getDashboardUser(userId)?.mustChange, true);
  assert.ok(await verifyPassword("pw-wrong-check", "the-real-password"));
});

test("PATCH with a new password shorter than 8 chars is 400", async () => {
  const userId = seedInitialUser("pw-short-check", "the-real-password");
  const token = createSession(userId);
  const res = await passwordRoute.PATCH(
    new Request("https://x/api/account/password", {
      method: "PATCH",
      headers: { cookie: `jroute_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "the-real-password", newPassword: "short" }),
    })
  );
  assert.equal(res.status, 400);
});

test("PATCH with the correct current password changes it and clears must_change", async () => {
  const userId = seedInitialUser("pw-success-check", "old-password");
  const token = createSession(userId);
  assert.equal(getDashboardUser(userId)?.mustChange, true);

  const res = await passwordRoute.PATCH(
    new Request("https://x/api/account/password", {
      method: "PATCH",
      headers: { cookie: `jroute_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "old-password", newPassword: "brand-new-password" }),
    })
  );
  assert.equal(res.status, 200);
  assert.equal(getDashboardUser(userId)?.mustChange, false);
  assert.equal(await verifyPassword("pw-success-check", "old-password"), null);
  assert.ok(await verifyPassword("pw-success-check", "brand-new-password"));
});
