// tests/unit/api-regex-presets.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-api-regex-presets-"));
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

test("POST /api/regex-presets requires dashboard auth", async () => {
  const { POST } = await import("../../src/app/api/regex-presets/route.ts");
  const res = await POST(
    new Request("http://localhost/api/regex-presets", {
      method: "POST",
      body: JSON.stringify({ name: "X", scripts: [] }),
    })
  );
  assert.equal(res.status, 401);
});

test("POST /api/regex-presets creates and returns an id", async () => {
  const { POST } = await import("../../src/app/api/regex-presets/route.ts");
  const res = await POST(
    new Request("http://localhost/api/regex-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({
        name: "Strip secret",
        scripts: [{ scriptName: "s", findRegex: "/secret/", replaceString: "[redacted]" }],
      }),
    })
  );
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: number };
  assert.ok(Number.isInteger(id));
});

test("POST /api/regex-presets rejects an unsafe findRegex pattern", async () => {
  const { POST } = await import("../../src/app/api/regex-presets/route.ts");
  const res = await POST(
    new Request("http://localhost/api/regex-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({
        name: "Evil",
        scripts: [{ scriptName: "s", findRegex: "/(a+)+$/", replaceString: "" }],
      }),
    })
  );
  assert.equal(res.status, 400);
});

test("POST /api/regex-presets rejects an invalid script shape", async () => {
  const { POST } = await import("../../src/app/api/regex-presets/route.ts");
  const res = await POST(
    new Request("http://localhost/api/regex-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "Bad", scripts: [{ scriptName: "", findRegex: "" }] }),
    })
  );
  assert.equal(res.status, 400);
});

test("GET /api/regex-presets lists created presets", async () => {
  const { GET } = await import("../../src/app/api/regex-presets/route.ts");
  const res = await GET(
    new Request("http://localhost/api/regex-presets", { headers: DASHBOARD_AUTH_HEADER })
  );
  assert.equal(res.status, 200);
  const list = (await res.json()) as Array<{ name: string }>;
  assert.ok(list.some((p) => p.name === "Strip secret"));
});

test("GET /api/regex-presets/:id returns 404 for an unknown id", async () => {
  const { GET } = await import("../../src/app/api/regex-presets/[id]/route.ts");
  const res = await GET(
    new Request("http://localhost/api/regex-presets/999999", { headers: DASHBOARD_AUTH_HEADER }),
    { params: Promise.resolve({ id: "999999" }) }
  );
  assert.equal(res.status, 404);
});

test("PATCH /api/regex-presets/:id updates scripts", async () => {
  const { POST } = await import("../../src/app/api/regex-presets/route.ts");
  const created = await POST(
    new Request("http://localhost/api/regex-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "Editable", scripts: [] }),
    })
  );
  const { id } = (await created.json()) as { id: number };

  const { PATCH, GET } = await import("../../src/app/api/regex-presets/[id]/route.ts");
  const res = await PATCH(
    new Request(`http://localhost/api/regex-presets/${id}`, {
      method: "PATCH",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({
        scripts: [{ scriptName: "hi", findRegex: "/hi/", replaceString: "yo" }],
      }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);

  const got = await GET(
    new Request(`http://localhost/api/regex-presets/${id}`, { headers: DASHBOARD_AUTH_HEADER }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  const preset = (await got.json()) as { scripts: Array<{ scriptName: string }> };
  assert.equal(preset.scripts[0].scriptName, "hi");
});

test("DELETE /api/regex-presets/:id removes the preset", async () => {
  const { POST } = await import("../../src/app/api/regex-presets/route.ts");
  const created = await POST(
    new Request("http://localhost/api/regex-presets", {
      method: "POST",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ name: "Deletable", scripts: [] }),
    })
  );
  const { id } = (await created.json()) as { id: number };

  const { DELETE } = await import("../../src/app/api/regex-presets/[id]/route.ts");
  const res = await DELETE(
    new Request(`http://localhost/api/regex-presets/${id}`, {
      method: "DELETE",
      headers: DASHBOARD_AUTH_HEADER,
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);

  const { GET } = await import("../../src/app/api/regex-presets/[id]/route.ts");
  const got = await GET(
    new Request(`http://localhost/api/regex-presets/${id}`, { headers: DASHBOARD_AUTH_HEADER }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(got.status, 404);
});
