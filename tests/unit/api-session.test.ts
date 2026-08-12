import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, verifySession } = await import("../../src/lib/auth/sessions.ts");
const session = await import("../../src/app/api/session/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("POST with correct credentials sets a session cookie", async () => {
  seedInitialUser("admin", "correct-horse-battery-staple");
  const res = await session.POST(
    new Request("https://x/api/session", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" }),
    })
  );
  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.match(cookie, /jroute_session=[0-9a-f]{64}/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test("POST with wrong password is 401 and sets no cookie", async () => {
  seedInitialUser("admin2", "correct-password");
  const res = await session.POST(
    new Request("https://x/api/session", {
      method: "POST",
      body: JSON.stringify({ username: "admin2", password: "wrong" }),
    })
  );
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("DELETE with a valid session cookie destroys it", async () => {
  const userId = seedInitialUser("admin3", "another-password");
  const loginRes = await session.POST(
    new Request("https://x/api/session", {
      method: "POST",
      body: JSON.stringify({ username: "admin3", password: "another-password" }),
    })
  );
  const token = (loginRes.headers.get("set-cookie") ?? "").match(
    /jroute_session=([0-9a-f]{64})/
  )?.[1];
  assert.ok(token);
  assert.equal(verifySession(token!), userId);

  const res = await session.DELETE(
    new Request("https://x/api/session", {
      method: "DELETE",
      headers: { cookie: `jroute_session=${token}` },
    })
  );
  assert.equal(res.status, 200);
  assert.equal(verifySession(token!), null);
});
