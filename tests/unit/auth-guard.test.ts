// tests/unit/auth-guard.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { issueApiKey } = await import("../../src/lib/auth/apiKeys.ts");
const { seedInitialUser, createSession, SESSION_COOKIE } =
  await import("../../src/lib/auth/sessions.ts");
const { authenticateProxy, authenticateDashboard, corsHeadersFor } =
  await import("../../src/lib/auth/guard.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const req = (headers: Record<string, string>) => new Request("https://x/", { headers });

test("proxy accepts a valid API key in either header form", () => {
  const { id, secret } = issueApiKey("janitor");
  assert.equal(authenticateProxy(req({ authorization: `Bearer ${secret}` }))?.id, id);
  assert.equal(authenticateProxy(req({ "x-api-key": secret }))?.id, id);
});

test("proxy REJECTS a dashboard session cookie", () => {
  const userId = seedInitialUser("admin", "pw");
  const token = createSession(userId);
  assert.equal(authenticateProxy(req({ cookie: `${SESSION_COOKIE}=${token}` })), null);
});

test("dashboard REJECTS a proxy API key", () => {
  const { secret } = issueApiKey("janitor");
  assert.equal(authenticateDashboard(req({ authorization: `Bearer ${secret}` })), null);
  assert.equal(authenticateDashboard(req({ "x-api-key": secret })), null);
});

test("dashboard accepts a valid session cookie", () => {
  const userId = seedInitialUser("admin2", "pw");
  const token = createSession(userId);
  assert.equal(authenticateDashboard(req({ cookie: `${SESSION_COOKIE}=${token}` })), userId);
});

test("CORS is open on /v1 and closed elsewhere", () => {
  const v1 = corsHeadersFor("/v1/chat/completions", "https://janitorai.com");
  assert.equal(v1["Access-Control-Allow-Origin"], "*");
  const admin = corsHeadersFor("/api/providers", "https://janitorai.com");
  assert.equal(admin["Access-Control-Allow-Origin"], undefined);
});
