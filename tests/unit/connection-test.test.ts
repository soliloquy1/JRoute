// tests/unit/connection-test.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

// Same trampoline pattern as tests/unit/routes.test.ts: `execute()`'s default
// `fetchImpl` parameter is evaluated per-call (not captured at module load), so
// swapping `globalThis.fetch` before each call is sufficient here.
let fetchStub: typeof fetch = async () =>
  new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = ((...args: Parameters<typeof fetch>) => fetchStub(...args)) as typeof fetch;

const { resetDb, getDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection, getConnectionById } = await import("../../src/lib/db/connections.ts");
const { testConnection } = await import("../../src/lib/dashboard/testConnection.ts");
const testRoute = await import("../../src/app/api/connections/[id]/test/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = { cookie: `jroute_session=${token}` };

upsertProvider({
  id: "openai",
  name: "OpenAI",
  kind: "apikey",
  baseUrl: "https://api.openai.com/v1",
  wireFormat: "openai",
  enabled: true,
});
const connId = createConnection("openai", "primary", "sk-test");

test("a successful upstream call clears cooldown", async () => {
  fetchStub = async () =>
    new Response('{"choices":[{"message":{"content":"pong"}}]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const result = await testConnection(connId);
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(getConnectionById(connId)?.cooldownUntil, null);
});

test("a failing upstream call sets cooldown with the executor's error", async () => {
  fetchStub = async () => new Response("upstream unavailable", { status: 503 });
  const result = await testConnection(connId);
  assert.equal(result.ok, false);
  assert.equal(result.error, "upstream unavailable");
  const conn = getConnectionById(connId);
  assert.ok(conn?.cooldownUntil && conn.cooldownUntil > Date.now());
  assert.equal(conn?.lastError, "upstream unavailable");
});

test("a connection whose provider has no configured model reports a clear error, no crash", async () => {
  upsertProvider({
    id: "mystery",
    name: "Mystery",
    kind: "apikey",
    baseUrl: "https://mystery.example.com",
    wireFormat: "openai",
    enabled: true,
  });
  const mysteryConnId = createConnection("mystery", "primary", "sk-test");
  const result = await testConnection(mysteryConnId);
  assert.equal(result.ok, false);
  assert.equal(result.error, "No models configured for this provider");
});

test("a connection with an undecryptable credential reports a clear error, no network call", async () => {
  const info = getDb()
    .prepare("INSERT INTO connections (provider_id, label, api_key) VALUES (?, ?, ?)")
    .run("openai", "broken", "enc:v1:deadbeef:cafebabe:00112233445566778899aabbccddeeff");
  const brokenConnId = Number(info.lastInsertRowid);
  const broken = getConnectionById(brokenConnId);
  assert.equal(broken?.credentialDecryptFailed, true);

  let fetchCalled = false;
  fetchStub = async () => {
    fetchCalled = true;
    return new Response('{"choices":[{"message":{"content":"pong"}}]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await testConnection(brokenConnId);
  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    "Stored credential could not be decrypted — check STORAGE_ENCRYPTION_KEY"
  );
  assert.equal(fetchCalled, false);
});

test("getConnectionById returns null for a missing id", () => {
  assert.equal(getConnectionById(999999), null);
});

test("POST /api/connections/:id/test without a session is 401", async () => {
  const res = await testRoute.POST(
    new Request(`https://x/api/connections/${connId}/test`, { method: "POST" }),
    { params: Promise.resolve({ id: String(connId) }) }
  );
  assert.equal(res.status, 401);
});

test("POST /api/connections/:id/test runs a real test with a session", async () => {
  fetchStub = async () =>
    new Response('{"choices":[{"message":{"content":"pong"}}]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const res = await testRoute.POST(
    new Request(`https://x/api/connections/${connId}/test`, {
      method: "POST",
      headers: authHeaders,
    }),
    { params: Promise.resolve({ id: String(connId) }) }
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; error: string | null };
  assert.equal(body.ok, true);
  assert.equal(body.error, null);
});

test("POST /api/connections/:id/test with an invalid id is 400", async () => {
  const res = await testRoute.POST(
    new Request("https://x/api/connections/not-a-number/test", {
      method: "POST",
      headers: authHeaders,
    }),
    { params: Promise.resolve({ id: "not-a-number" }) }
  );
  assert.equal(res.status, 400);
});
