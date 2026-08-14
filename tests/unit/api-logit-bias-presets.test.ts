// tests/unit/api-logit-bias-presets.test.ts
// Exact fixture pattern from tests/unit/api-rich-presets.test.ts (verified against that
// file): module-level DB setup + a real session token, not a fabricated cookie string.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-api-logit-bias-presets-"));
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

test("POST /api/logit-bias-presets requires dashboard auth", async () => {
  const { POST } = await import("../../src/app/api/logit-bias-presets/route.ts");
  const res = await POST(
    new Request("http://localhost/api/logit-bias-presets", {
      method: "POST",
      body: JSON.stringify({ name: "X", entries: [] }),
    })
  );
  assert.equal(res.status, 401);
});

test("POST /api/logit-bias-presets creates and returns an id", async () => {
  const { POST } = await import("../../src/app/api/logit-bias-presets/route.ts");
  const res = await POST(
    new Request("http://localhost/api/logit-bias-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "No Suddenly", entries: [{ text: "suddenly", value: -80 }] }),
    })
  );
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: number };
  assert.ok(Number.isInteger(id));
});

test("POST /api/logit-bias-presets rejects an invalid entry shape", async () => {
  const { POST } = await import("../../src/app/api/logit-bias-presets/route.ts");
  const res = await POST(
    new Request("http://localhost/api/logit-bias-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "Bad", entries: [{ text: "", value: 999 }] }),
    })
  );
  assert.equal(res.status, 400);
});

test("POST /api/logit-bias-presets rejects more entries than the cap", async () => {
  const { POST } = await import("../../src/app/api/logit-bias-presets/route.ts");
  const { MAX_LOGIT_BIAS_ENTRIES } = await import("../../src/lib/prompts/logitBiasSchema.ts");
  const res = await POST(
    new Request("http://localhost/api/logit-bias-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({
        name: "Too Many",
        entries: Array.from({ length: MAX_LOGIT_BIAS_ENTRIES + 1 }, () => ({
          text: "x",
          value: 0,
        })),
      }),
    })
  );
  assert.equal(res.status, 400);
});

test("POST /api/logit-bias-presets rejects entry text longer than the cap", async () => {
  const { POST } = await import("../../src/app/api/logit-bias-presets/route.ts");
  const { MAX_LOGIT_BIAS_TEXT_LEN } = await import("../../src/lib/prompts/logitBiasSchema.ts");
  const res = await POST(
    new Request("http://localhost/api/logit-bias-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({
        name: "Too Long",
        entries: [{ text: "a".repeat(MAX_LOGIT_BIAS_TEXT_LEN + 1), value: 0 }],
      }),
    })
  );
  assert.equal(res.status, 400);
});

test("GET /api/logit-bias-presets lists created presets", async () => {
  const { GET } = await import("../../src/app/api/logit-bias-presets/route.ts");
  const res = await GET(
    new Request("http://localhost/api/logit-bias-presets", { headers: DASHBOARD_AUTH_HEADER })
  );
  assert.equal(res.status, 200);
  const list = (await res.json()) as Array<{ name: string }>;
  assert.ok(list.some((p) => p.name === "No Suddenly"));
});

test("GET /api/logit-bias-presets/:id returns 404 for an unknown id", async () => {
  const { GET } = await import("../../src/app/api/logit-bias-presets/[id]/route.ts");
  const res = await GET(
    new Request("http://localhost/api/logit-bias-presets/999999", {
      headers: DASHBOARD_AUTH_HEADER,
    }),
    { params: Promise.resolve({ id: "999999" }) }
  );
  assert.equal(res.status, 404);
});

test("PATCH /api/logit-bias-presets/:id updates entries", async () => {
  const { POST } = await import("../../src/app/api/logit-bias-presets/route.ts");
  const created = await POST(
    new Request("http://localhost/api/logit-bias-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "Editable", entries: [] }),
    })
  );
  const { id } = (await created.json()) as { id: number };

  const { PATCH } = await import("../../src/app/api/logit-bias-presets/[id]/route.ts");
  const res = await PATCH(
    new Request(`http://localhost/api/logit-bias-presets/${id}`, {
      method: "PATCH",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ entries: [{ text: "hi", value: 10 }] }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);

  const { GET } = await import("../../src/app/api/logit-bias-presets/[id]/route.ts");
  const got = await GET(
    new Request(`http://localhost/api/logit-bias-presets/${id}`, {
      headers: DASHBOARD_AUTH_HEADER,
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  const preset = (await got.json()) as { entries: Array<{ text: string; value: number }> };
  assert.deepEqual(preset.entries, [{ text: "hi", value: 10 }]);
});

test("PATCH then GET /api/logit-bias-presets/:id exposes the clamped stored value", async () => {
  // The dashboard editor re-reads the preset after saving precisely because of this: an
  // out-of-range value is stored clamped, so the submitted number is not what the proxy
  // will send.
  const { POST } = await import("../../src/app/api/logit-bias-presets/route.ts");
  const created = await POST(
    new Request("http://localhost/api/logit-bias-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "Clamped", entries: [] }),
    })
  );
  const { id } = (await created.json()) as { id: number };

  const { PATCH, GET } = await import("../../src/app/api/logit-bias-presets/[id]/route.ts");
  const patched = await PATCH(
    new Request(`http://localhost/api/logit-bias-presets/${id}`, {
      method: "PATCH",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ entries: [{ text: "x", value: 500 }] }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(patched.status, 200);

  const got = await GET(
    new Request(`http://localhost/api/logit-bias-presets/${id}`, {
      headers: DASHBOARD_AUTH_HEADER,
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  const preset = (await got.json()) as { entries: Array<{ text: string; value: number }> };
  assert.deepEqual(preset.entries, [{ text: "x", value: 100 }]);
});

test("DELETE /api/logit-bias-presets/:id removes the preset", async () => {
  const { POST } = await import("../../src/app/api/logit-bias-presets/route.ts");
  const created = await POST(
    new Request("http://localhost/api/logit-bias-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "Deletable", entries: [] }),
    })
  );
  const { id } = (await created.json()) as { id: number };

  const { DELETE } = await import("../../src/app/api/logit-bias-presets/[id]/route.ts");
  const res = await DELETE(
    new Request(`http://localhost/api/logit-bias-presets/${id}`, {
      method: "DELETE",
      headers: DASHBOARD_AUTH_HEADER,
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);

  const { GET } = await import("../../src/app/api/logit-bias-presets/[id]/route.ts");
  const got = await GET(
    new Request(`http://localhost/api/logit-bias-presets/${id}`, {
      headers: DASHBOARD_AUTH_HEADER,
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(got.status, 404);
});
