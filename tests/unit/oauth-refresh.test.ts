// tests/unit/oauth-refresh.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-oauth-refresh-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { upsertOAuthToken, getOAuthToken } = await import("../../src/lib/db/oauthTokens.ts");
const { refreshOAuthToken } = await import("../../src/lib/oauth/refresh.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  db.prepare("DELETE FROM oauth_tokens").run();
});

function provider(id: string, oauthProvider: string) {
  upsertProvider({
    id,
    name: id,
    kind: "oauth",
    baseUrl: "https://example.invalid",
    wireFormat: "openai",
    enabled: true,
    oauthProvider,
  });
  return { id: id, name: id, kind: "oauth" as const, baseUrl: "https://example.invalid", wireFormat: "openai" as const, enabled: true, oauthProvider };
}

test("refreshOAuthToken: no refresh_token stored ⇒ null (kilocode's long-lived token)", async () => {
  const p = provider("kilocode", "kilocode");
  const connId = createConnection("kilocode", "c1", "");
  upsertOAuthToken({ provider: "kilocode", connectionId: connId, accessToken: "tok", refreshToken: null, expiresAt: null });
  const result = await refreshOAuthToken(p, connId);
  assert.equal(result, null);
});

test("refreshOAuthToken: claude sends a form-encoded refresh_token grant and persists the new token", async () => {
  const p = provider("claude", "claude");
  const connId = createConnection("claude", "c1", "");
  upsertOAuthToken({ provider: "claude", connectionId: connId, accessToken: "old", refreshToken: "refresh-1", expiresAt: 0 });

  const original = globalThis.fetch;
  let capturedBody: string | null = null;
  let capturedHeaders: Headers | null = null;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = String(init?.body);
    capturedHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await refreshOAuthToken(p, connId);
    assert.equal(result, "new-access");
    assert.equal(capturedHeaders?.get("content-type"), "application/x-www-form-urlencoded");
    assert.ok(capturedBody?.includes("grant_type=refresh_token"));
    assert.ok(capturedBody?.includes("refresh_token=refresh-1"));
    const stored = getOAuthToken("claude", connId);
    assert.equal(stored?.accessToken, "new-access");
    assert.equal(stored?.refreshToken, "new-refresh");
  } finally {
    globalThis.fetch = original;
  }
});

test("refreshOAuthToken: cline sends a JSON refresh body (not form-encoded)", async () => {
  const p = provider("cline", "cline");
  const connId = createConnection("cline", "c1", "");
  upsertOAuthToken({ provider: "cline", connectionId: connId, accessToken: "old", refreshToken: "refresh-1", expiresAt: 0 });

  const original = globalThis.fetch;
  let capturedBody: string | null = null;
  let capturedContentType: string | null = null;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = String(init?.body);
    capturedContentType = new Headers(init?.headers).get("content-type");
    return new Response(
      JSON.stringify({ data: { accessToken: "new-access", refreshToken: "new-refresh" } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await refreshOAuthToken(p, connId);
    assert.equal(result, "new-access");
    assert.equal(capturedContentType, "application/json");
    const parsed = JSON.parse(capturedBody as string);
    assert.equal(parsed.refreshToken, "refresh-1");
    assert.equal(parsed.grantType, "refresh_token");
  } finally {
    globalThis.fetch = original;
  }
});

test("refreshOAuthToken: clinepass reuses the cline refresh flow", async () => {
  const p = provider("clinepass", "clinepass");
  const connId = createConnection("clinepass", "c1", "");
  upsertOAuthToken({ provider: "clinepass", connectionId: connId, accessToken: "old", refreshToken: "refresh-1", expiresAt: 0 });

  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ accessToken: "new-access" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const result = await refreshOAuthToken(p, connId);
    assert.equal(result, "new-access");
  } finally {
    globalThis.fetch = original;
  }
});

test("refreshOAuthToken: upstream failure returns null and leaves the stored token untouched", async () => {
  const p = provider("xai-oauth", "xai-oauth");
  const connId = createConnection("xai-oauth", "c1", "");
  upsertOAuthToken({ provider: "xai-oauth", connectionId: connId, accessToken: "old", refreshToken: "refresh-1", expiresAt: 0 });

  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("invalid_grant", { status: 400 })) as typeof fetch;

  try {
    const result = await refreshOAuthToken(p, connId);
    assert.equal(result, null);
    const stored = getOAuthToken("xai-oauth", connId);
    assert.equal(stored?.accessToken, "old");
  } finally {
    globalThis.fetch = original;
  }
});
