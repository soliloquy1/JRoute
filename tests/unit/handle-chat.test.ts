// tests/unit/handle-chat.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;
// src/lib/db/encryption.ts:62 reads STORAGE_ENCRYPTION_KEY. Any other name leaves
// isEncryptionEnabled() false and encrypt() passes plaintext straight through.
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection, listConnections } = await import("../../src/lib/db/connections.ts");
const { issueApiKey, verifyApiKey } = await import("../../src/lib/auth/apiKeys.ts");
const { handleChat } = await import("../../jroute/handleChat.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  db.prepare("DELETE FROM usage_logs").run();
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
});

const post = (body: unknown) =>
  new Request("https://x/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const key = () => verifyApiKey(issueApiKey("janitor").secret)!;

test("rejects a body that fails validation", async () => {
  const res = await handleChat(post({ messages: [] }), key());
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { message: string } };
  assert.ok(!body.error.message.includes("at /"), "must not leak a stack trace");
});

test("returns 503 when no connection is configured", async () => {
  const res = await handleChat(
    post({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    key()
  );
  assert.equal(res.status, 503);
});

test("proxies a non-streaming response and logs usage", async () => {
  createConnection("openai", "primary", "sk-1");
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 7 } }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  const res = await handleChat(
    post({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 200);
  const row = getDb().prepare("SELECT * FROM usage_logs").get() as {
    prompt_tokens: number;
    output_tokens: number;
  };
  assert.equal(row.prompt_tokens, 5);
  assert.equal(row.output_tokens, 7);
});

test("falls back to the next connection and cools down the failed one", async () => {
  const first = createConnection("openai", "first", "sk-1");
  const second = createConnection("openai", "second", "sk-2");
  getDb().prepare("UPDATE connections SET priority = 10 WHERE id = ?").run(first);
  getDb().prepare("UPDATE connections SET priority = 20 WHERE id = ?").run(second);

  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    seen.push(auth);
    if (auth.endsWith("sk-1")) return new Response("boom", { status: 503 });
    return new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const res = await handleChat(
    post({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ["Bearer sk-1", "Bearer sk-2"]);
  const cooled = listConnections("openai").find((c) => c.id === first);
  assert.ok((cooled?.cooldownUntil ?? 0) > Date.now(), "failed connection must be cooling down");
});

test("does NOT fall back on a terminal 400", async () => {
  createConnection("openai", "first", "sk-1");
  createConnection("openai", "second", "sk-2");
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response("bad request", { status: 400 });
  };
  const res = await handleChat(
    post({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 400);
  assert.equal(calls, 1, "a terminal error must not be retried on another connection");
});

test("streams with SSE headers when stream is requested", async () => {
  createConnection("openai", "primary", "sk-1");
  const fetchImpl: typeof fetch = async () =>
    new Response(new ReadableStream({ start: (c) => c.close() }), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const res = await handleChat(
    post({ model: "gpt-4", stream: true, messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  assert.equal(res.headers.get("x-accel-buffering"), "no");
});

test("returns 499 and writes no usage row when client disconnects mid-request (abort)", async () => {
  createConnection("openai", "primary", "sk-1");
  const controller = new AbortController();
  const fetchImpl: typeof fetch = async () => {
    // Simulate client hanging up before upstream responds
    controller.abort();
    // Return a response that the signal-aware executor will treat as an abort
    throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
  };
  const req = new Request("https://x/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    signal: controller.signal,
  });
  const apiKey = key();
  const res = await handleChat(req, apiKey, { fetchImpl });
  assert.equal(res.status, 499);
  // Verify no usage row was written — beforeEach clears the table so an unscoped
  // count is safe, but bind by key id as a defense against future parallelism.
  const count = (
    getDb().prepare("SELECT COUNT(*) as n FROM usage_logs WHERE api_key_id = ?").get(apiKey.id) as {
      n: number;
    }
  ).n;
  assert.equal(count, 0, "abort must not create a usage row");
});

test("skips connections with failed credential decryption and falls back to healthy ones", async () => {
  // Insert a raw encrypted-looking value directly (bypasses encrypt()) to simulate
  // a rotated key — connections.ts will set credentialDecryptFailed = true for it.
  const db = getDb();
  db.prepare(
    "INSERT INTO connections (provider_id, label, api_key, priority) VALUES (?, ?, ?, ?)"
  ).run("openai", "bad-cred", "enc:v1:AAAAAAAAdeadbeef", 10);
  const goodId = createConnection("openai", "good-cred", "sk-good");
  db.prepare("UPDATE connections SET priority = 20 WHERE id = ?").run(goodId);

  let calledWith = "";
  const fetchImpl: typeof fetch = async (_url, init) => {
    calledWith = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const res = await handleChat(
    post({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 200, "should succeed via the healthy connection");
  assert.ok(calledWith.includes("sk-good"), "must have used the healthy connection's key");
  // Bad-cred connection must not have been cooled down (it's a config problem, not a health problem)
  const badConn = listConnections("openai").find((c) => c.label === "bad-cred");
  assert.equal(badConn?.cooldownUntil, null, "decrypt-failed connection must not be cooled down");
});
