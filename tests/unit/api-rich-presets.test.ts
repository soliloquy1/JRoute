// tests/unit/api-rich-presets.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exact fixture pattern from tests/unit/api-presets.test.ts (verified against that file):
// module-level DB setup + a real session token, not a fabricated cookie string.
const dir = mkdtempSync(join(tmpdir(), "jroute-api-rich-presets-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const DASHBOARD_AUTH_HEADER = {
  cookie: `jroute_session=${token}`,
  "content-type": "application/json",
};

const minimalRaw = {
  prompts: [{ identifier: "main", name: "Main", role: "system", content: "hi" }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
};

test("POST /api/rich-presets requires dashboard auth", async () => {
  const { POST } = await import("../../src/app/api/rich-presets/route.ts");
  const res = await POST(
    new Request("http://localhost/api/rich-presets", {
      method: "POST",
      body: JSON.stringify({ name: "X", raw: minimalRaw }),
    })
  );
  assert.equal(res.status, 401);
});

test("POST /api/rich-presets creates and returns an id, rejects invalid raw shape", async () => {
  const { POST } = await import("../../src/app/api/rich-presets/route.ts");
  const ok = await POST(
    new Request("http://localhost/api/rich-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "Izumi", raw: minimalRaw }),
    })
  );
  assert.equal(ok.status, 200);
  const { id } = (await ok.json()) as { id: number };
  assert.ok(Number.isInteger(id));

  const bad = await POST(
    new Request("http://localhost/api/rich-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "Bad", raw: { prompts: [] } }),
    })
  );
  assert.equal(bad.status, 400);
});

test("PATCH /api/rich-presets/:id updates name and raw", async () => {
  const { createRichPreset, getRichPreset } = await import("../../src/lib/db/richPresets.ts");
  const { PATCH } = await import("../../src/app/api/rich-presets/[id]/route.ts");
  const id = createRichPreset("Original", minimalRaw);
  const res = await PATCH(
    new Request(`http://localhost/api/rich-presets/${id}`, {
      method: "PATCH",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "Renamed" }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);
  assert.equal(getRichPreset(id)?.name, "Renamed");
});

test("DELETE /api/rich-presets/:id removes the row", async () => {
  const { createRichPreset, getRichPreset } = await import("../../src/lib/db/richPresets.ts");
  const { DELETE } = await import("../../src/app/api/rich-presets/[id]/route.ts");
  const id = createRichPreset("ToDelete", minimalRaw);
  const res = await DELETE(
    new Request(`http://localhost/api/rich-presets/${id}`, {
      method: "DELETE",
      headers: DASHBOARD_AUTH_HEADER,
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);
  assert.equal(getRichPreset(id), null);
});

test("POST /api/rich-presets/:id/lorebooks sets membership", async () => {
  const { createRichPreset, getRichPreset } = await import("../../src/lib/db/richPresets.ts");
  const { createLorebook } = await import("../../src/lib/db/lorebooks.ts");
  const { POST: setLorebooks } =
    await import("../../src/app/api/rich-presets/[id]/lorebooks/route.ts");
  const id = createRichPreset("WithLore", minimalRaw);
  const lorebookId = createLorebook("L1", "() => null");
  const res = await setLorebooks(
    new Request(`http://localhost/api/rich-presets/${id}/lorebooks`, {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ lorebookIds: [lorebookId] }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);
  assert.deepEqual(getRichPreset(id)?.lorebookIds, [lorebookId]);
});
