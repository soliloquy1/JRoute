// tests/unit/handle-chat-oauth-401.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-oauth401-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { createModel } = await import("../../src/lib/db/models.ts");
const { issueApiKey, verifyApiKey } = await import("../../src/lib/auth/apiKeys.ts");
const { upsertOAuthToken, getOAuthToken } = await import("../../src/lib/db/oauthTokens.ts");
const { warmUpSandbox } = await import("../../src/lib/lorebooks/sandbox.ts");
const { handleChat } = await import("../../jroute/handleChat.ts");

await warmUpSandbox();

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  db.prepare("DELETE FROM oauth_tokens").run();
  db.prepare("DELETE FROM usage_logs").run();
  db.prepare("DELETE FROM models").run();
  upsertProvider({
    id: "claude",
    name: "Claude Code",
    kind: "oauth",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "openai",
    enabled: true,
    oauthProvider: "claude",
  });
  createModel("claude", "claude-3-5-sonnet");
});

const post = (body: unknown) =>
  new Request("https://x/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const key = () => verifyApiKey(issueApiKey("janitor").secret)!;

test("401 on an oauth connection refreshes once and retries the SAME connection", async () => {
  const connId = createConnection("claude", "c1", "");
  upsertOAuthToken({
    provider: "claude",
    connectionId: connId,
    accessToken: "stale",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 60_000,
  });

  let chatCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    chatCalls += 1;
    if (chatCalls === 1) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
    return new Response(
      JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const originalFetch = globalThis.fetch;
  let refreshCalls = 0;
  globalThis.fetch = (async () => {
    refreshCalls += 1;
    return new Response(
      JSON.stringify({ access_token: "fresh", refresh_token: "refresh-2", expires_in: 3600 }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const res = await handleChat(
      post({ model: "claude-3-5-sonnet", messages: [{ role: "user", content: "hi" }] }),
      key(),
      { fetchImpl }
    );
    assert.equal(res.status, 200);
    assert.equal(chatCalls, 2, "retried the same connection after refresh");
    assert.equal(refreshCalls, 1, "refreshed exactly once");
    assert.equal(getOAuthToken("claude", connId)?.accessToken, "fresh");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("401 with a refresh that fails over to a sibling connection", async () => {
  const badConn = createConnection("claude", "bad", "");
  const goodConn = createConnection("claude", "good", "");
  upsertOAuthToken({
    provider: "claude",
    connectionId: badConn,
    accessToken: "stale",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 60_000,
  });
  upsertOAuthToken({
    provider: "claude",
    connectionId: goodConn,
    accessToken: "good-token",
    refreshToken: "refresh-2",
    expiresAt: Date.now() + 60_000,
  });

  const fetchImpl: typeof fetch = async (_url, init) => {
    const auth = new Headers(init?.headers).get("authorization");
    if (auth === "Bearer good-token") {
      return new Response(
        JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("invalid_grant", { status: 400 })) as typeof fetch;

  try {
    const res = await handleChat(
      post({ model: "claude-3-5-sonnet", messages: [{ role: "user", content: "hi" }] }),
      key(),
      { fetchImpl }
    );
    assert.equal(res.status, 200, "failed over to the sibling connection with a good token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an oauth token that fails to decrypt is skipped before dialing, not sent as a blind 401", async () => {
  const connId = createConnection("claude", "c1", "");
  upsertOAuthToken({
    provider: "claude",
    connectionId: connId,
    accessToken: "will-corrupt",
    refreshToken: null,
    expiresAt: null,
  });
  const raw = getDb()
    .prepare("SELECT access_token FROM oauth_tokens WHERE provider = 'claude' AND connection_id = ?")
    .get(connId) as { access_token: string };
  const corrupted = raw.access_token.slice(0, -4) + "beef";
  getDb()
    .prepare("UPDATE oauth_tokens SET access_token = ? WHERE provider = 'claude' AND connection_id = ?")
    .run(corrupted, connId);

  let dialed = false;
  const fetchImpl: typeof fetch = async () => {
    dialed = true;
    return new Response("should not be called", { status: 200 });
  };

  const res = await handleChat(
    post({ model: "claude-3-5-sonnet", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(dialed, false, "must not fire a blind request with an undecryptable token");
  // Matches the existing api_key credentialDecryptFailed fallback status (502) — no
  // real upstream attempt was ever made, same as that pre-existing skip path.
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /decrypt/i);
});
