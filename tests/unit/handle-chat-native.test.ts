// tests/unit/handle-chat-native.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-handle-chat-native-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { createModel } = await import("../../src/lib/db/models.ts");
const { handleChat } = await import("../../jroute/handleChat.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM connections").run();
  getDb().prepare("DELETE FROM providers").run();
  getDb().prepare("DELETE FROM models").run();
  getDb().prepare("DELETE FROM mcp_servers").run();
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
  createConnection("openai", "primary", "sk-test");
  createModel("openai", "gpt-5.6-sol", 8000);
});

function nativeKey() {
  return {
    id: 1,
    keyHash: "hash",
    label: "native-key",
    presetId: null,
    richPresetId: null,
    logitBiasPresetId: null,
    regexPresetId: null,
    toolMode: "native" as const,
    rateLimitPerMin: 1000,
    createdAt: Date.now(),
  };
}

test("a native-mode key with no MCP tools configured resolves in one round, JSON response", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        id: "x",
        choices: [
          { message: { role: "assistant", content: "plain answer" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as unknown as typeof fetch;

  const req = new Request("https://x/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "hi" }] }),
  });
  const res = await handleChat(req, nativeKey(), { fetchImpl });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
  };
  assert.equal(body.choices[0].message.content, "plain answer");
  assert.equal(body.choices[0].finish_reason, "stop");
});

test("a native-mode key with stream:true gets a single-chunk SSE response, finish_reason always stop", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        id: "x",
        choices: [
          {
            message: { role: "assistant", content: "streamed-looking answer" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as unknown as typeof fetch;

  const req = new Request("https://x/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-5.6-sol",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    }),
  });
  const res = await handleChat(req, nativeKey(), { fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const text = await res.text();
  assert.ok(text.includes("streamed-looking answer"));
  assert.ok(text.includes('"finish_reason":"stop"'));
  assert.ok(text.includes("data: [DONE]"));
});

test('a client disconnect mid-loop returns a bare 499, not an uncaught RangeError from jsonError(0, "")', async () => {
  // Matches dispatchAttempt.ts's real abort detection: execute() classifies a fetch
  // rejection as an abort when the error's `name` is "AbortError" (isAbort's err.name
  // check alone is sufficient — the same pattern the non-native path's own
  // dispatch-attempt.test.ts abort test uses), independent of whether the actual request
  // signal object was aborted.
  const fetchImpl = (async () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    throw err;
  }) as unknown as typeof fetch;

  const req = new Request("https://x/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "hi" }] }),
  });
  const res = await handleChat(req, nativeKey(), { fetchImpl });
  assert.equal(res.status, 499);
  assert.equal(await res.text(), "");
});

test("a non-native (trigger/off) key's behavior is completely unaffected by this task", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ id: "x", choices: [{ message: { content: "unaffected" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  const offKey = { ...nativeKey(), toolMode: "off" as const };
  const req = new Request("https://x/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "hi" }] }),
  });
  const res = await handleChat(req, offKey, { fetchImpl });
  assert.equal(res.status, 200);
});
