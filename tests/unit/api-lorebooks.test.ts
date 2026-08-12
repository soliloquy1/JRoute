// tests/unit/api-lorebooks.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { getLorebook } = await import("../../src/lib/db/lorebooks.ts");
const lorebooks = await import("../../src/app/api/lorebooks/route.ts");
const lorebookById = await import("../../src/app/api/lorebooks/[id]/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = { cookie: `jroute_session=${token}`, "content-type": "application/json" };

test("POST /api/lorebooks without a session is 401", async () => {
  const res = await lorebooks.POST(
    new Request("https://x/api/lorebooks", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
});

test("POST /api/lorebooks creates a lorebook with defaults", async () => {
  const res = await lorebooks.POST(
    new Request("https://x/api/lorebooks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "weather",
        source: "if (ctx.match(/weather/)) return 'It rains.';",
      }),
    })
  );
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: number };
  const lb = getLorebook(id);
  assert.equal(lb?.enabled, true);
  assert.equal(lb?.scope, "character");
});

test("POST /api/lorebooks with an invalid scope is 400", async () => {
  const res = await lorebooks.POST(
    new Request("https://x/api/lorebooks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "x", source: "x", scope: "world" }),
    })
  );
  assert.equal(res.status, 400);
});

test("PATCH /api/lorebooks/:id can disable a lorebook", async () => {
  const res = await lorebooks.POST(
    new Request("https://x/api/lorebooks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "y", source: "x" }),
    })
  );
  const { id } = (await res.json()) as { id: number };
  const patchRes = await lorebookById.PATCH(
    new Request(`https://x/api/lorebooks/${id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ enabled: false }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(patchRes.status, 200);
  assert.equal(getLorebook(id)?.enabled, false);
});

test("DELETE /api/lorebooks/:id removes it", async () => {
  const res = await lorebooks.POST(
    new Request("https://x/api/lorebooks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "z", source: "x" }),
    })
  );
  const { id } = (await res.json()) as { id: number };
  const delRes = await lorebookById.DELETE(
    new Request(`https://x/api/lorebooks/${id}`, { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(delRes.status, 200);
  assert.equal(getLorebook(id), null);
});
