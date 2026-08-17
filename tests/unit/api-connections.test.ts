// tests/unit/api-connections.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { listConnections } = await import("../../src/lib/db/connections.ts");
const connections = await import("../../src/app/api/connections/route.ts");
const connectionById = await import("../../src/app/api/connections/[id]/route.ts");

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

upsertProvider({
  id: "openai",
  name: "OpenAI",
  kind: "apikey",
  baseUrl: "https://api.openai.com/v1",
  wireFormat: "openai",
  enabled: true,
});

upsertProvider({
  id: "test-prov-1",
  name: "Test Provider 1",
  kind: "apikey",
  baseUrl: "https://api.test-provider-1.com/v1",
  wireFormat: "openai",
  enabled: true,
});

test("POST /api/connections with an unknown provider is 400", async () => {
  const res = await connections.POST(
    new Request("https://x/api/connections", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        providerId: "does-not-exist",
        label: "primary",
        apiKey: "sk-test",
      }),
    })
  );
  assert.equal(res.status, 400);
  assert.equal(listConnections("does-not-exist").length, 0);
});

test("POST /api/connections with a priority stores it", async () => {
  const res = await connections.POST(
    new Request("https://x/api/connections", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        providerId: "test-prov-1",
        label: "primary",
        apiKey: "sk-test",
        priority: 7,
      }),
    })
  );
  assert.equal(res.status, 200);
  const [conn] = listConnections("test-prov-1");
  assert.equal(conn.priority, 7);
});

test("POST /api/connections without priority defaults to 100", async () => {
  const res = await connections.POST(
    new Request("https://x/api/connections", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        providerId: "test-prov-1",
        label: "secondary",
        apiKey: "sk-test",
      }),
    })
  );
  assert.equal(res.status, 200);
  const conns = listConnections("test-prov-1");
  assert.ok(conns.length >= 2);
  const secondary = conns.find((c) => c.label === "secondary");
  assert.equal(secondary?.priority, 100);
});

test("POST /api/connections without a session is 401", async () => {
  const res = await connections.POST(
    new Request("https://x/api/connections", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
});

test("POST /api/connections creates a connection", async () => {
  const res = await connections.POST(
    new Request("https://x/api/connections", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ providerId: "openai", label: "primary", apiKey: "sk-test" }),
    })
  );
  assert.equal(res.status, 200);
  assert.equal(listConnections("openai").length, 1);
});

test("PATCH /api/connections/:id updates priority", async () => {
  const [conn] = listConnections("openai");
  const res = await connectionById.PATCH(
    new Request(`https://x/api/connections/${conn.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ priority: 5 }),
    }),
    { params: Promise.resolve({ id: String(conn.id) }) }
  );
  assert.equal(res.status, 200);
  assert.equal(listConnections("openai")[0].priority, 5);
});

test("PATCH /api/connections/:id with an empty body is 400", async () => {
  const [conn] = listConnections("openai");
  const res = await connectionById.PATCH(
    new Request(`https://x/api/connections/${conn.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id: String(conn.id) }) }
  );
  assert.equal(res.status, 400);
});

test("PATCH /api/connections/:id without a session is 401", async () => {
  const [conn] = listConnections("openai");
  const res = await connectionById.PATCH(
    new Request(`https://x/api/connections/${conn.id}`, {
      method: "PATCH",
      body: JSON.stringify({ priority: 1 }),
    }),
    { params: Promise.resolve({ id: String(conn.id) }) }
  );
  assert.equal(res.status, 401);
});

test("PATCH /api/connections/:id with a non-numeric id is 400", async () => {
  const res = await connectionById.PATCH(
    new Request("https://x/api/connections/abc", {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ priority: 1 }),
    }),
    { params: Promise.resolve({ id: "abc" }) }
  );
  assert.equal(res.status, 400);
});

test("DELETE /api/connections/:id with a non-numeric id is 400", async () => {
  const res = await connectionById.DELETE(
    new Request("https://x/api/connections/abc", { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ id: "abc" }) }
  );
  assert.equal(res.status, 400);
});

test("DELETE /api/connections/:id removes it", async () => {
  const [conn] = listConnections("openai");
  const res = await connectionById.DELETE(
    new Request(`https://x/api/connections/${conn.id}`, { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ id: String(conn.id) }) }
  );
  assert.equal(res.status, 200);
  assert.equal(listConnections("openai").length, 0);
});
