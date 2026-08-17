// tests/unit/api-oauth.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-api-oauth-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { listConnections } = await import("../../src/lib/db/connections.ts");
const { getOAuthToken } = await import("../../src/lib/db/oauthTokens.ts");
const { clearCallbackFlow } = await import("../../src/lib/oauth/callbackState.ts");
const oauthRoute = await import("../../src/app/api/oauth/[provider]/[action]/route.ts");

after(() => {
  clearCallbackFlow("xai-oauth");
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = { cookie: `jroute_session=${token}`, "content-type": "application/json" };

beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  db.prepare("DELETE FROM oauth_tokens").run();
  upsertProvider({
    id: "claude",
    name: "Claude Code",
    kind: "oauth",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: true,
    oauthProvider: "claude",
  });
  upsertProvider({
    id: "kilocode",
    name: "Kilo Code",
    kind: "oauth",
    baseUrl: "https://api.kilo.ai",
    wireFormat: "openai",
    enabled: true,
    oauthProvider: "kilocode",
  });
  upsertProvider({
    id: "xai-oauth",
    name: "xAI OAuth",
    kind: "oauth",
    baseUrl: "https://api.x.ai",
    wireFormat: "openai",
    enabled: true,
    oauthProvider: "xai-oauth",
  });
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
});

function get(url: string, provider: string, action: string) {
  return oauthRoute.GET(new Request(url, { headers: authHeaders }), {
    params: Promise.resolve({ provider, action }),
  });
}
function post(url: string, provider: string, action: string, body: unknown) {
  return oauthRoute.POST(
    new Request(url, { method: "POST", headers: authHeaders, body: JSON.stringify(body) }),
    { params: Promise.resolve({ provider, action }) }
  );
}

test("GET authorize without a session is 401", async () => {
  const res = await oauthRoute.GET(new Request("https://x/api/oauth/claude/authorize"), {
    params: Promise.resolve({ provider: "claude", action: "authorize" }),
  });
  assert.equal(res.status, 401);
});

test("GET authorize for a non-oauth provider is 400", async () => {
  const res = await get("https://x/api/oauth/openai/authorize", "openai", "authorize");
  assert.equal(res.status, 400);
});

test("GET authorize for claude returns a PKCE auth URL with the fixed redirect_uri", async () => {
  const res = await get("https://x/api/oauth/claude/authorize", "claude", "authorize");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { authUrl: string; codeVerifier: string; state: string };
  assert.ok(body.authUrl.startsWith("https://claude.ai/oauth/authorize?"));
  assert.ok(body.authUrl.includes("code_challenge="));
  assert.ok(body.codeVerifier.length > 0);
});

test("GET authorize for xai-oauth (loopback provider) is 400 — use start-callback-server instead", async () => {
  const res = await get("https://x/api/oauth/xai-oauth/authorize", "xai-oauth", "authorize");
  assert.equal(res.status, 400);
});

test("GET device-code for kilocode requests + returns the device code", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: "ABC123", verificationUrl: "https://kilo.ai/v/ABC123", expiresIn: 300 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const res = await get("https://x/api/oauth/kilocode/device-code", "kilocode", "device-code");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { userCode: string; verificationUriComplete: string };
    assert.equal(body.userCode, "ABC123");
    assert.equal(body.verificationUriComplete, "https://kilo.ai/v/ABC123");
  } finally {
    globalThis.fetch = original;
  }
});

test("POST exchange for claude without codeVerifier is 400", async () => {
  const res = await post("https://x/api/oauth/claude/exchange", "claude", "exchange", {
    code: "abc",
    label: "primary",
  });
  assert.equal(res.status, 400);
});

test("POST exchange for claude creates a connection and persists the encrypted token", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: "tok-1", refresh_token: "ref-1", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const res = await post("https://x/api/oauth/claude/exchange", "claude", "exchange", {
      code: "abc#state1",
      codeVerifier: "verifier",
      state: "state1",
      label: "primary",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; connectionId: number };
    assert.equal(body.success, true);
    const conns = listConnections("claude");
    assert.equal(conns.length, 1);
    assert.equal(conns[0].id, body.connectionId);
    const stored = getOAuthToken("claude", body.connectionId);
    assert.equal(stored?.accessToken, "tok-1");
  } finally {
    globalThis.fetch = original;
  }
});

test("POST poll for kilocode: pending stays pending, approved creates a connection", async () => {
  const original = globalThis.fetch;
  let approved = false;
  globalThis.fetch = (async () => {
    if (!approved) return new Response(null, { status: 202 });
    return new Response(JSON.stringify({ status: "approved", token: "kilo-tok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const pending = await post("https://x/api/oauth/kilocode/poll", "kilocode", "poll", {
      deviceCode: "dc-1",
      label: "primary",
    });
    assert.equal(pending.status, 200);
    const pendingBody = (await pending.json()) as { success: boolean; pending: boolean };
    assert.equal(pendingBody.success, false);
    assert.equal(pendingBody.pending, true);

    approved = true;
    const done = await post("https://x/api/oauth/kilocode/poll", "kilocode", "poll", {
      deviceCode: "dc-1",
      label: "primary",
    });
    assert.equal(done.status, 200);
    const doneBody = (await done.json()) as { success: boolean; connectionId: number };
    assert.equal(doneBody.success, true);
    assert.equal(listConnections("kilocode").length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("start-callback-server + poll-callback round-trips a full xai-oauth flow", async () => {
  const startRes = await get(
    "https://x/api/oauth/xai-oauth/start-callback-server?label=primary",
    "xai-oauth",
    "start-callback-server"
  );
  assert.equal(startRes.status, 200);
  const { serverPort } = (await startRes.json()) as { serverPort: number };

  // Poll before the callback lands: pending.
  const pending = await post("https://x/api/oauth/xai-oauth/poll-callback", "xai-oauth", "poll-callback", {});
  assert.equal(pending.status, 200);
  assert.equal(((await pending.json()) as { pending: boolean }).pending, true);

  // Drive the actual browser redirect: hit the loopback server's /callback using the
  // REAL fetch, before the upstream token-exchange fetch gets mocked below.
  const { getCallbackFlow } = await import("../../src/lib/oauth/callbackState.ts");
  const flow = getCallbackFlow("xai-oauth");
  assert.ok(flow, "callback flow state must exist");

  const original = globalThis.fetch;
  await original(
    `http://127.0.0.1:${serverPort}/callback?code=abc123&state=${encodeURIComponent(flow!.state)}`
  );
  // Give the local server's request handler a tick to fire onCallback.
  await new Promise((r) => setTimeout(r, 50));

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: "xai-tok", refresh_token: "xai-ref", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const done = await post("https://x/api/oauth/xai-oauth/poll-callback", "xai-oauth", "poll-callback", {});
    assert.equal(done.status, 200);
    const doneBody = (await done.json()) as { success: boolean; connectionId: number };
    assert.equal(doneBody.success, true);
    assert.equal(listConnections("xai-oauth").length, 1);
  } finally {
    globalThis.fetch = original;
    clearCallbackFlow("xai-oauth");
  }
});
