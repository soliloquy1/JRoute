// tests/unit/api-presets.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { createPreset, getPreset } = await import("../../src/lib/db/presets.ts");
const { createLorebook } = await import("../../src/lib/db/lorebooks.ts");
const presetById = await import("../../src/app/api/presets/[id]/route.ts");
const presetLorebooks = await import("../../src/app/api/presets/[id]/lorebooks/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = { cookie: `jroute_session=${token}`, "content-type": "application/json" };

test("PATCH /api/presets/:id without a session is 401", async () => {
  const res = await presetById.PATCH(
    new Request("https://x/api/presets/1", { method: "PATCH", body: "{}" }),
    { params: Promise.resolve({ id: "1" }) }
  );
  assert.equal(res.status, 401);
});

test("PATCH /api/presets/:id updates tool mode", async () => {
  const id = createPreset("p");
  const res = await presetById.PATCH(
    new Request(`https://x/api/presets/${id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ toolMode: "trigger" }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);
  assert.equal(getPreset(id)?.toolMode, "trigger");
});

test("PATCH /api/presets/:id with an empty body is 400", async () => {
  const id = createPreset("p2");
  const res = await presetById.PATCH(
    new Request(`https://x/api/presets/${id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 400);
});

test("POST /api/presets without a session is 401", async () => {
  const presetsRoute = await import("../../src/app/api/presets/route.ts");
  const res = await presetsRoute.POST(
    new Request("https://x/api/presets", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
});

test("POST /api/presets creates a preset", async () => {
  const presetsRoute = await import("../../src/app/api/presets/route.ts");
  const res = await presetsRoute.POST(
    new Request("https://x/api/presets", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "new-preset" }),
    })
  );
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: number };
  assert.equal(getPreset(id)?.name, "new-preset");
});

test("POST /api/presets/:id/lorebooks replaces the lorebook membership", async () => {
  const id = createPreset("p3");
  const lbA = createLorebook("a", "x");
  const lbB = createLorebook("b", "x");
  const res = await presetLorebooks.POST(
    new Request(`https://x/api/presets/${id}/lorebooks`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ lorebookIds: [lbA, lbB] }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);
  assert.deepEqual(getPreset(id)?.lorebookIds.sort(), [lbA, lbB].sort());
});
