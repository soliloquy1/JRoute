// tests/unit/handle-chat.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaggedBlock } from "../../jroute/convert/types.ts";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;
// src/lib/db/encryption.ts:62 reads STORAGE_ENCRYPTION_KEY. Any other name leaves
// isEncryptionEnabled() false and encrypt() passes plaintext straight through.
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection, listConnections } = await import("../../src/lib/db/connections.ts");
const { issueApiKey, verifyApiKey, setApiKeyPreset } =
  await import("../../src/lib/auth/apiKeys.ts");
const { createPromptBlock } = await import("../../src/lib/db/promptBlocks.ts");
const { createPreset } = await import("../../src/lib/db/presets.ts");
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
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
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
  const apiKey = key();
  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl }
  );
  assert.equal(res.status, 200);
  // Bind on the api key id. An unscoped `SELECT * FROM usage_logs` is only safe because
  // beforeEach truncates; the moment a test writes more than one row it reads the wrong
  // one and passes silently. This is the standing hazard on this plan.
  const row = getDb().prepare("SELECT * FROM usage_logs WHERE api_key_id = ?").get(apiKey.id) as {
    prompt_tokens: number;
    output_tokens: number;
  };
  assert.equal(row.prompt_tokens, 5);
  assert.equal(row.output_tokens, 7);
});

test("assembles the key's preset into the upstream request body", async () => {
  // `beforeEach` in this file already upserts provider id "openai" (wireFormat "openai");
  // "gpt-4o" is statically mapped to it in jroute/convert/models.ts MODEL_MAP — reuse both
  // rather than inventing a provider id, since MODEL_MAP is a fixed table, not DB-driven.
  createConnection("openai", "primary", "sk-test");

  const prependId = createPromptBlock("jailbreak", "prepend", "Stay in character.");
  const presetId = createPreset("default", { prependBlockId: prependId });
  // NOTE: `key()` returns a plain snapshot `ApiKeyRecord`, not a live reference — calling
  // `setApiKeyPreset` on a record already fetched via `key()` would update the DB row but
  // leave the in-memory `presetId` stale at `null`. Issue the key first, set its preset,
  // then re-fetch via `verifyApiKey` so `apiKey.presetId` reflects the preset just assigned.
  const issued = issueApiKey("janitor");
  setApiKeyPreset(issued.id, presetId);
  const apiKey = verifyApiKey(issued.secret)!;

  let capturedBody: unknown = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "x", choices: [], usage: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await handleChat(
    post({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    }),
    apiKey,
    { fetchImpl }
  );

  const messages = (capturedBody as { messages: Array<{ role: string; content: unknown }> })
    .messages;
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "Stay in character.");
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
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
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
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 400);
  assert.equal(calls, 1, "a terminal error must not be retried on another connection");
});

test("streams with SSE headers when stream is requested", async () => {
  createConnection("openai", "primary", "sk-1");
  const encoder = new TextEncoder();
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start: (c) => {
          c.enqueue(encoder.encode('data: {"delta":"hi"}\n\n'));
          c.enqueue(encoder.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  const res = await handleChat(
    post({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  // Headers alone are not enough: `new Response(null, { status: 502, headers: sseHeaders() })`
  // — wrong status, upstream stream dropped, keepaliveStream never called — satisfies a
  // headers-only assertion. Pin the status and actually drain the body.
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  assert.equal(res.headers.get("x-accel-buffering"), "no");
  assert.ok(res.body, "must forward the upstream stream, not a null body");
  const text = await res.text();
  assert.match(text, /data: \{"delta":"hi"\}/, "upstream stream content must reach the client");
  assert.match(text, /data: \[DONE\]/);
});

test("returns 499 and writes no usage row when client disconnects mid-request (abort)", async () => {
  const connId = createConnection("openai", "primary", "sk-1");
  let calls = 0;
  // Deliberately does NOT abort the request's own signal. The executor classifies this
  // as a hangup via `err.name === "AbortError"` (executor.ts::isAbort), so it returns the
  // contract signature status 0 + errorMessage null while `req.signal.aborted` stays
  // false. That gap is the whole point: an implementation that read `req.signal.aborted`
  // instead of the executor's return value would NOT produce 499 here, so this test can
  // tell the two apart. The previous version aborted the controller as well and could not.
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
  };
  const apiKey = key();
  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl }
  );
  assert.equal(res.status, 499);
  assert.equal(res.body, null, "a client that hung up gets no body");
  assert.equal(calls, 1, "an abort must not fail over to another connection");
  const count = (
    getDb().prepare("SELECT COUNT(*) as n FROM usage_logs WHERE api_key_id = ?").get(apiKey.id) as {
      n: number;
    }
  ).n;
  assert.equal(count, 0, "abort must not create a usage row");
  const conn = listConnections("openai").find((c) => c.id === connId);
  assert.equal(conn?.cooldownUntil, null, "abort must not cool down the connection");
});

test("a transport failure (status 0, non-null message) still fails over", async () => {
  const first = createConnection("openai", "first", "sk-1");
  const second = createConnection("openai", "second", "sk-2");
  getDb().prepare("UPDATE connections SET priority = 10 WHERE id = ?").run(first);
  getDb().prepare("UPDATE connections SET priority = 20 WHERE id = ?").run(second);

  const seen: string[] = [];
  // A genuine connection-refused: NOT an AbortError, signal never aborted. The executor
  // returns status 0 with a non-null errorMessage and retryable: true. Narrowing the
  // hangup check to `result.status === 0` alone would swallow this as a silent 499.
  const fetchImpl: typeof fetch = async (_url, init) => {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    seen.push(auth);
    if (auth.endsWith("sk-1")) throw new TypeError("fetch failed: ECONNREFUSED");
    return new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 200, "a transport failure must fail over, not return 499");
  assert.deepEqual(seen, ["Bearer sk-1", "Bearer sk-2"]);
});

test("returns the credential reason only when EVERY candidate is decrypt-failed", async () => {
  const db = getDb();
  for (const label of ["bad-1", "bad-2"]) {
    db.prepare(
      "INSERT INTO connections (provider_id, label, api_key, priority) VALUES (?, ?, ?, ?)"
    ).run("openai", label, "enc:v1:AAAAAAAAdeadbeef", 10);
  }
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [] }), { status: 200 });
  };
  const apiKey = key();
  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl }
  );
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /could not be decrypted/);
  assert.equal(calls, 0, "a decrypt-failed connection must never be dialled");
  const row = getDb()
    .prepare("SELECT error, connection_id FROM usage_logs WHERE api_key_id = ?")
    .get(apiKey.id) as { error: string; connection_id: number | null };
  assert.match(row.error, /could not be decrypted/);
  assert.equal(row.connection_id, null, "no connection was actually attempted");
});

test("a real upstream failure outranks a decrypt-failed connection behind it", async () => {
  const db = getDb();
  const failing = createConnection("openai", "failing", "sk-1");
  db.prepare("UPDATE connections SET priority = 10 WHERE id = ?").run(failing);
  db.prepare(
    "INSERT INTO connections (provider_id, label, api_key, priority) VALUES (?, ?, ?, ?)"
  ).run("openai", "bad-cred", "enc:v1:AAAAAAAAdeadbeef", 20);

  const apiKey = key();
  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl: async () => new Response("upstream is on fire", { status: 503 }) }
  );
  // The 503 is the real cause. Letting the trailing decrypt-failed skip overwrite the
  // message produced a row saying "rotated key" for what was actually an outage.
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /on fire/);
  const row = getDb()
    .prepare("SELECT error, connection_id FROM usage_logs WHERE api_key_id = ?")
    .get(apiKey.id) as { error: string; connection_id: number | null };
  assert.match(row.error, /on fire/, "usage row must record the real upstream cause");
  assert.equal(row.connection_id, failing, "failure row must name the connection that failed");
});

test("preserves extra message fields (tool_call_id, tool_calls, name) on the way upstream", async () => {
  createConnection("openai", "primary", "sk-1");
  let sent: { messages: Array<Record<string, unknown>> } | null = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>> };
    return new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await handleChat(
    post({
      model: "gpt-4o",
      messages: [
        { role: "user", content: "hi", name: "westin" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function" }] },
        { role: "tool", content: "42", tool_call_id: "c1" },
      ],
    }),
    key(),
    { fetchImpl }
  );
  const messages = sent!.messages;
  // A stripped tool_call_id makes OpenAI 400 the request, and that 400 renders straight
  // to whoever is chatting. Stripping tool_calls silently guts a replayed tool turn.
  assert.equal(messages[0].name, "westin");
  assert.deepEqual(messages[1].tool_calls, [{ id: "c1", type: "function" }]);
  assert.equal(messages[2].tool_call_id, "c1");
});

// Addition C: content is optional on messages (OpenAI permits it on assistant tool-call messages).
// Mutant verified: reverting to `z.unknown()` (non-optional) makes this test fail while all
// previous tests still pass (they all send messages with a content field).
test("accepts an assistant tool-call message with no content key, rejects a message with no role", async () => {
  createConnection("openai", "primary", "sk-1");
  let sentBody: { messages: Array<Record<string, unknown>> } | null = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    sentBody = JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>> };
    return new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  // assistant message with tool_calls and NO content — OpenAI explicitly permits this shape
  const res = await handleChat(
    post({
      model: "gpt-4o",
      messages: [
        { role: "user", content: "call the tool" },
        {
          role: "assistant",
          tool_calls: [{ id: "c1", type: "function", function: { name: "f" } }],
        },
      ],
    }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 200, "tool-call message without content must be accepted");
  assert.ok(sentBody !== null, "request must have reached upstream");
  // Status 200 alone does not prove the message SURVIVED the schema — pin the exact wire
  // shape. Deliberately NOT asserting `!("content" in msg)` separately: JSON.stringify
  // drops an undefined value, so a materialised `content: undefined` is indistinguishable
  // from an absent one at this layer and such an assertion could never fail. deepEqual on
  // the wire shape is the honest form — it still catches a stripped tool_calls.
  assert.deepEqual(sentBody!.messages[1], {
    role: "assistant",
    tool_calls: [{ id: "c1", type: "function", function: { name: "f" } }],
  });

  // message with no role must still be rejected (schema guard for content alone is not enough)
  const res2 = await handleChat(post({ model: "gpt-4o", messages: [{ content: "hi" }] }), key(), {
    fetchImpl,
  });
  assert.equal(res2.status, 400, "a message with no role must be rejected with 400");
});

// Addition B: guard that the OUTER z.looseObject stays loose.
// Reverting the outer schema to z.object strips top-level fields (temperature,
// max_tokens, stop, tools, any vendor extension) from the body sent upstream —
// and the 12 tests above stay green because they only assert on message-level keys.
// Mutant was verified: changing the outer z.looseObject to z.object makes this fail.
test("preserves top-level unknown fields (temperature, max_tokens, custom extension) upstream", async () => {
  createConnection("openai", "primary", "sk-1");
  let sentBody: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await handleChat(
    post({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.7,
      max_tokens: 256,
      stop: ["\n"],
      x_custom_vendor_flag: true,
    }),
    key(),
    { fetchImpl }
  );
  assert.ok(sentBody !== null, "fetchImpl must have been called");
  // If the outer schema is z.object (not looseObject), these keys are silently stripped.
  assert.equal(sentBody!.temperature, 0.7, "temperature must reach upstream");
  assert.equal(sentBody!.max_tokens, 256, "max_tokens must reach upstream");
  assert.deepEqual(sentBody!.stop, ["\n"], "stop must reach upstream");
  assert.equal(sentBody!.x_custom_vendor_flag, true, "vendor extension must reach upstream");
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
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 200, "should succeed via the healthy connection");
  assert.ok(calledWith.includes("sk-good"), "must have used the healthy connection's key");
  // Bad-cred connection must not have been cooled down (it's a config problem, not a health problem)
  const badConn = listConnections("openai").find((c) => c.label === "bad-cred");
  assert.equal(badConn?.cooldownUntil, null, "decrypt-failed connection must not be cooled down");
});

test("resolves the model to its provider and converts to Anthropic shape", async () => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: true,
  });
  createConnection("anthropic", "primary", "sk-ant-1");

  let seenUrl = "";
  let seenBody: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "msg_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const blocks: TaggedBlock[] = [{ role: "system", content: "CARD", tag: "system-block" }];
  const res = await handleChat(
    post({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl, blocks }
  );

  assert.equal(res.status, 200);
  assert.equal(seenUrl, "https://api.anthropic.com/v1/messages");
  assert.deepEqual(seenBody.system, [{ type: "text", text: "CARD" }]);
  assert.equal(typeof seenBody.max_tokens, "number");
  assert.equal("messages" in seenBody, true);
});

test("an unknown model is a 404, not a 503", async () => {
  const res = await handleChat(
    post({ model: "no-such-model-anywhere", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl: async () => new Response("{}", { status: 200 }) }
  );
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { message: string } };
  assert.ok(!body.error.message.includes("at /"), "must not leak a stack trace");
});

test("a known model whose provider is absent is a 404", async () => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  const res = await handleChat(
    post({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl: async () => new Response("{}", { status: 200 }) }
  );
  assert.equal(res.status, 404);
});

test("the openai path still routes and converts as before", async () => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
  createConnection("openai", "primary", "sk-1");

  let seenUrl = "";
  let seenBody: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }], temperature: 0.5 }),
    key(),
    { fetchImpl }
  );

  assert.equal(res.status, 200);
  assert.equal(seenUrl, "https://api.openai.com/v1/chat/completions");
  assert.equal(seenBody.temperature, 0.5, "openai passthrough preserves unknown fields");
});

test("usage rows record the requested model id", async () => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  db.prepare("DELETE FROM usage_logs").run();
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: true,
  });
  createConnection("anthropic", "primary", "sk-ant-1");

  const apiKey = key();
  await handleChat(
    post({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    {
      fetchImpl: async () =>
        new Response(JSON.stringify({ id: "msg_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    }
  );

  const row = db
    .prepare("SELECT model, provider_id FROM usage_logs WHERE api_key_id = ?")
    .get(apiKey.id) as { model: string; provider_id: string };
  assert.equal(row.model, "claude-sonnet-4-6", "log the model the client asked for");
  assert.equal(row.provider_id, "anthropic", "and the provider that served it");
});

// (Removed Task-6 repurposed test "a gemini-wireFormat provider threads the model into the URL
// and passes the raw body through": its raw-passthrough assertion became false when Task 7
// registered the gemini response converter, and its URL-threading value is already covered by
// executor.test.ts's buildPath/execute cases. The fully-wired end-to-end gemini path is pinned
// by the three tests below.)

test("converts a non-streaming Anthropic response into OpenAI chat.completion shape", async () => {
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: true,
  });
  createConnection("anthropic", "primary", "sk-ant-1");
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        id: "msg_01ABC",
        content: [{ type: "text", text: "Hello from Claude" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 20, output_tokens: 8 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const apiKey = key();
  const res = await handleChat(
    post({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl }
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    object: string;
    choices: Array<{ message: { content: string } }>;
  };
  assert.equal(body.object, "chat.completion");
  assert.equal(body.choices[0].message.content, "Hello from Claude");
  const row = getDb().prepare("SELECT * FROM usage_logs WHERE api_key_id = ?").get(apiKey.id) as {
    prompt_tokens: number;
    output_tokens: number;
  };
  assert.equal(row.prompt_tokens, 20);
  assert.equal(row.output_tokens, 8);
});

test("a non-streaming OpenAI response is unchanged (registry returns null, passthrough)", async () => {
  createConnection("openai", "primary", "sk-1");
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { usage: { prompt_tokens: number } };
  assert.equal(
    body.usage.prompt_tokens,
    3,
    "regression: Plan 1's raw-passthrough behavior must survive for openai"
  );
});

test("streams a converted Anthropic response and defers usage logging to stream completion", async () => {
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: true,
  });
  createConnection("anthropic", "primary", "sk-ant-1");
  const encoder = new TextEncoder();
  const sequence =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01S","usage":{"input_tokens":9}}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start: (c) => {
          c.enqueue(encoder.encode(sequence));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  const apiKey = key();
  const res = await handleChat(
    post({ model: "claude-sonnet-4-6", stream: true, messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl }
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  // BEFORE draining the body, the row must not exist yet — usage is deferred to stream
  // completion, not written before the first byte (the bug design spec §9 fixes).
  const beforeDrain = getDb()
    .prepare("SELECT * FROM usage_logs WHERE api_key_id = ?")
    .get(apiKey.id);
  assert.equal(
    beforeDrain,
    undefined,
    "usage row must not exist before the stream has been consumed"
  );

  const text = await res.text();
  assert.match(text, /"role":"assistant"/);
  assert.match(text, /data: \[DONE\]/);

  const row = getDb().prepare("SELECT * FROM usage_logs WHERE api_key_id = ?").get(apiKey.id) as {
    prompt_tokens: number;
    output_tokens: number;
    error: string | null;
  };
  assert.equal(row.prompt_tokens, 9, "real prompt token count, not null");
  assert.equal(row.output_tokens, 2, "real output token count, not null");
  assert.equal(row.error, null);
});

test("streaming OpenAI response logs immediately with null tokens (unchanged from Plan 1)", async () => {
  createConnection("openai", "primary", "sk-1");
  const encoder = new TextEncoder();
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start: (c) => {
          c.enqueue(encoder.encode('data: {"delta":"hi"}\n\n'));
          c.enqueue(encoder.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  const apiKey = key();
  const res = await handleChat(
    post({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl }
  );
  assert.equal(res.status, 200);
  // Regression: unlike Anthropic, this row exists immediately — logged before the response
  // is even returned, exactly as Plan 1 did it. This plan deliberately does not change it.
  const row = getDb().prepare("SELECT * FROM usage_logs WHERE api_key_id = ?").get(apiKey.id) as {
    prompt_tokens: number | null;
    output_tokens: number | null;
  };
  assert.equal(row.prompt_tokens, null);
  assert.equal(row.output_tokens, null);
});

test("a post-dial client hangup on an Anthropic stream writes a row with partial tokens and a distinct error", async () => {
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: true,
  });
  createConnection("anthropic", "primary", "sk-ant-1");
  const encoder = new TextEncoder();
  // No message_stop — the "connection" stays open; the test cancels the response body
  // instead, simulating the client (Janitor) disconnecting mid-stream.
  const sequence =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01P","usage":{"input_tokens":6}}}\n\n';
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start: (c) => {
          c.enqueue(encoder.encode(sequence));
          // Deliberately never closes.
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  const apiKey = key();
  const res = await handleChat(
    post({ model: "claude-sonnet-4-6", stream: true, messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl }
  );
  assert.ok(res.body, "must forward a live stream to cancel");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();
  await reader.cancel("client went away");
  const row = getDb().prepare("SELECT * FROM usage_logs WHERE api_key_id = ?").get(apiKey.id) as {
    prompt_tokens: number;
    error: string;
  };
  assert.equal(row.prompt_tokens, 6);
  assert.equal(row.error, "client disconnected mid-stream");
});

test("a billing_error from Anthropic reaches the client with a distinct, sanitized message", async () => {
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: true,
  });
  createConnection("anthropic", "primary", "sk-ant-1");
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        type: "error",
        error: { type: "billing_error", message: "insufficient credit" },
      }),
      { status: 403 }
    );
  const res = await handleChat(
    post({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: { message: string } };
  assert.ok(body.error.message.toLowerCase().includes("billing"));
});

// Mutant-3 permanent guard: mapAnthropicErrorMessage must be gated on wireFormat === "anthropic".
// An OpenAI-compatible upstream returning a body that looks like an Anthropic billing_error JSON
// must NOT get the Anthropic-specific message treatment — that would be cross-format contamination.
test("an OpenAI upstream 403 whose body looks like Anthropic billing_error JSON is NOT remapped", async () => {
  createConnection("openai", "primary", "sk-1");
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        type: "error",
        error: { type: "billing_error", message: "insufficient credit" },
      }),
      { status: 403 }
    );
  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    key(),
    { fetchImpl }
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: { message: string } };
  // Must NOT contain the Anthropic-specific prefix — the raw upstream message must pass through.
  assert.ok(
    !body.error.message.toLowerCase().includes("billing issue with the upstream anthropic"),
    "OpenAI upstream error must not be remapped through Anthropic error mapper"
  );
});

test("converts a non-streaming Gemini response into OpenAI chat.completion shape", async () => {
  upsertProvider({
    id: "google",
    name: "Google",
    kind: "apikey",
    baseUrl: "https://generativelanguage.googleapis.com",
    wireFormat: "gemini",
    enabled: true,
  });
  createConnection("google", "primary", "gk-1");
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello from Gemini" }] },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, totalTokenCount: 28 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const apiKey = key();
  const res = await handleChat(
    post({ model: "gemini-2.0-flash", messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl }
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    object: string;
    choices: Array<{ message: { content: string } }>;
  };
  assert.equal(body.object, "chat.completion");
  assert.equal(body.choices[0].message.content, "Hello from Gemini");
  const row = getDb().prepare("SELECT * FROM usage_logs WHERE api_key_id = ?").get(apiKey.id) as {
    prompt_tokens: number;
    output_tokens: number;
  };
  assert.equal(row.prompt_tokens, 20);
  assert.equal(row.output_tokens, 8);
});

test("streams a converted Gemini response and defers usage logging to stream completion", async () => {
  upsertProvider({
    id: "google",
    name: "Google",
    kind: "apikey",
    baseUrl: "https://generativelanguage.googleapis.com",
    wireFormat: "gemini",
    enabled: true,
  });
  createConnection("google", "primary", "gk-1");
  const encoder = new TextEncoder();
  const wire =
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"hi"}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":2,"totalTokenCount":11}}\n\n';
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start: (c) => {
          c.enqueue(encoder.encode(wire));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  const apiKey = key();
  const res = await handleChat(
    post({ model: "gemini-2.0-flash", stream: true, messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl }
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  const beforeDrain = getDb()
    .prepare("SELECT * FROM usage_logs WHERE api_key_id = ?")
    .get(apiKey.id);
  assert.equal(beforeDrain, undefined, "usage row must not exist before the stream is consumed");

  const text = await res.text();
  assert.match(text, /"role":"assistant"/);
  assert.match(text, /data: \[DONE\]/);

  const row = getDb().prepare("SELECT * FROM usage_logs WHERE api_key_id = ?").get(apiKey.id) as {
    prompt_tokens: number;
    output_tokens: number;
    error: string | null;
  };
  assert.equal(row.prompt_tokens, 9);
  assert.equal(row.output_tokens, 2);
  assert.equal(row.error, null);
});

test("a post-dial hangup on a Gemini stream writes a row with partial tokens and a distinct error", async () => {
  upsertProvider({
    id: "google",
    name: "Google",
    kind: "apikey",
    baseUrl: "https://generativelanguage.googleapis.com",
    wireFormat: "gemini",
    enabled: true,
  });
  createConnection("google", "primary", "gk-1");
  const encoder = new TextEncoder();
  // A content frame carrying usageMetadata but no finishReason; source never closes.
  const wire =
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"partial"}]}}],"usageMetadata":{"promptTokenCount":6}}\n\n';
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start: (c) => {
          c.enqueue(encoder.encode(wire));
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  const apiKey = key();
  const res = await handleChat(
    post({ model: "gemini-2.0-flash", stream: true, messages: [{ role: "user", content: "hi" }] }),
    apiKey,
    { fetchImpl }
  );
  assert.ok(res.body, "must forward a live stream to cancel");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();
  await reader.cancel("client went away");
  const row = getDb().prepare("SELECT * FROM usage_logs WHERE api_key_id = ?").get(apiKey.id) as {
    prompt_tokens: number;
    error: string;
  };
  assert.equal(row.prompt_tokens, 6);
  assert.equal(row.error, "client disconnected mid-stream");
});
