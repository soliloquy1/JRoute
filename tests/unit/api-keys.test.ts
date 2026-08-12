// tests/unit/api-keys.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { listApiKeys } = await import("../../src/lib/auth/apiKeys.ts");
const { createPreset } = await import("../../src/lib/db/presets.ts");
const keysRoute = await import("../../src/app/api/keys/route.ts");
const keyById = await import("../../src/app/api/keys/[id]/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = {
  cookie: `jroute_session=${token}`,
  "content-type": "application/json",
};

test("POST /api/keys without a session is 401", async () => {
  const res = await keysRoute.POST(
    new Request("https://x/api/keys", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
});

test("POST /api/keys issues a key and returns the secret once", async () => {
  const res = await keysRoute.POST(
    new Request("https://x/api/keys", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ label: "janitor-prod", toolMode: "trigger" }),
    })
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id: number; secret: string };
  assert.match(body.secret, /^jr-[0-9a-f]{64}$/);
  assert.ok(listApiKeys().some((k) => k.id === body.id && k.toolMode === "trigger"));
});

test("PATCH /api/keys/:id assigns a preset", async () => {
  const presetId = createPreset("default");
  const [key] = listApiKeys();
  const res = await keyById.PATCH(
    new Request(`https://x/api/keys/${key.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ presetId }),
    }),
    { params: Promise.resolve({ id: String(key.id) }) }
  );
  assert.equal(res.status, 200);
  assert.equal(listApiKeys().find((k) => k.id === key.id)?.presetId, presetId);
});

test("PATCH /api/keys/:id with a non-numeric id is 400", async () => {
  const res = await keyById.PATCH(
    new Request("https://x/api/keys/abc", {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ presetId: null }),
    }),
    { params: Promise.resolve({ id: "abc" }) }
  );
  assert.equal(res.status, 400);
});

test("DELETE /api/keys/:id with a non-numeric id is 400", async () => {
  const res = await keyById.DELETE(
    new Request("https://x/api/keys/abc", { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ id: "abc" }) }
  );
  assert.equal(res.status, 400);
});

test("DELETE /api/keys/:id revokes it", async () => {
  const [key] = listApiKeys();
  const res = await keyById.DELETE(
    new Request(`https://x/api/keys/${key.id}`, { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ id: String(key.id) }) }
  );
  assert.equal(res.status, 200);
  assert.ok(!listApiKeys().some((k) => k.id === key.id));
});
