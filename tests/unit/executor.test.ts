// tests/unit/executor.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  execute,
  classifyStatus,
  cooldownMsFor,
  describeWire,
  WIRE_DESCRIPTORS,
} from "../../jroute/executor.ts";
import type { Provider, Connection } from "../../src/lib/db/types.ts";

const provider: Provider = {
  id: "openai",
  name: "OpenAI",
  kind: "apikey",
  baseUrl: "https://api.openai.com/v1",
  wireFormat: "openai",
  enabled: true,
};

const connection: Connection = {
  id: 1,
  providerId: "openai",
  label: "primary",
  apiKey: "sk-test",
  priority: 100,
  cooldownUntil: null,
  lastError: null,
  credentialDecryptFailed: false,
};

test("classifies transient statuses as retryable", () => {
  for (const s of [408, 429, 500, 502, 503, 504]) {
    assert.equal(classifyStatus(s).retryable, true, `${s} should be retryable`);
  }
});

test("classifies client errors as terminal", () => {
  for (const s of [400, 401, 403, 404, 422]) {
    assert.equal(classifyStatus(s).retryable, false, `${s} should be terminal`);
  }
});

test("cooldown grows exponentially and caps at five minutes", () => {
  assert.equal(cooldownMsFor(429, 0), 3000);
  assert.equal(cooldownMsFor(429, 1), 6000);
  assert.equal(cooldownMsFor(429, 2), 12000);
  assert.equal(cooldownMsFor(429, 20), 300000);
});

test("sends Bearer auth to the provider chat endpoint", async () => {
  let seenUrl = "";
  let seenAuth: string | null = null;
  const fakeFetch: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenAuth = new Headers(init?.headers).get("authorization");
    return new Response('{"ok":true}', { status: 200 });
  };
  const res = await execute(
    { provider, connection, body: { model: "gpt-4" }, signal: new AbortController().signal },
    fakeFetch
  );
  assert.equal(seenUrl, "https://api.openai.com/v1/chat/completions");
  assert.equal(seenAuth, "Bearer sk-test");
  assert.equal(res.ok, true);
  assert.deepEqual(res.json, { ok: true });
});

test("marks an upstream 503 retryable and does not leak the body into errorMessage", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response("upstream exploded at /srv/app/main.js:42", { status: 503 });
  const res = await execute(
    { provider, connection, body: {}, signal: new AbortController().signal },
    fakeFetch
  );
  assert.equal(res.ok, false);
  assert.equal(res.retryable, true);
  assert.ok(!res.errorMessage?.includes("/srv/app"), "must not leak upstream paths");
});

test("treats a client abort as terminal, not retryable", async () => {
  const ac = new AbortController();
  // Mirrors how Node's undici actually rejects: name "AbortError", instanceof Error,
  // with signal.aborted already true by the time the rejection lands.
  const fakeFetch: typeof fetch = async () => {
    ac.abort();
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    throw err;
  };
  const res = await execute({ provider, connection, body: {}, signal: ac.signal }, fakeFetch);
  assert.equal(res.ok, false);
  assert.equal(res.status, 0);
  assert.equal(res.retryable, false, "an abandoned request must not fail over");
  assert.equal(res.errorMessage, null, "there is no client left to show a message to");
});

test("still treats a genuine transport failure as retryable", async () => {
  const fakeFetch: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const res = await execute(
    { provider, connection, body: {}, signal: new AbortController().signal },
    fakeFetch
  );
  assert.equal(res.retryable, true, "a real transport error must still fail over");
});

test("does not hang when an error body stalls and the client is already gone", async () => {
  const ac = new AbortController();
  // A body that never enqueues and never closes: res.text() can never resolve, so if
  // execute() settles at all it is because the signal binding cut the read short.
  const stalling = new ReadableStream<Uint8Array>({ start() {} });
  const fakeFetch: typeof fetch = async () => new Response(stalling, { status: 503 });
  const pending = execute({ provider, connection, body: {}, signal: ac.signal }, fakeFetch);
  ac.abort();
  const res = await pending;
  assert.equal(res.retryable, false, "aborted mid-read must not fail over on a 503");
  assert.equal(res.errorMessage, null);
});

test("does not hang when the client aborts after the body read has begun", async () => {
  const ac = new AbortController();
  const stalling = new ReadableStream<Uint8Array>({ start() {} });
  const fakeFetch: typeof fetch = async () => new Response(stalling, { status: 503 });
  const pending = execute({ provider, connection, body: {}, signal: ac.signal }, fakeFetch);
  // Microtasks drain before timers, so the read is already in flight and the abort
  // listener registered when this fires — this exercises the listener path rather than
  // the already-aborted early return. The read itself can never resolve, so the outcome
  // does not depend on timing.
  setTimeout(() => ac.abort(), 0);
  const res = await pending;
  assert.equal(res.retryable, false);
  assert.equal(res.errorMessage, null);
});

test("returns a stream when the upstream streams", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(new ReadableStream(), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const res = await execute(
    { provider, connection, body: { stream: true }, signal: new AbortController().signal },
    fakeFetch
  );
  assert.ok(res.stream instanceof ReadableStream);
  assert.equal(res.json, null);
});

const anthropicProvider: Provider = {
  id: "anthropic",
  name: "Anthropic",
  kind: "apikey",
  baseUrl: "https://api.anthropic.com",
  wireFormat: "anthropic",
  enabled: true,
};

const anthropicConnection: Connection = {
  id: 2,
  providerId: "anthropic",
  label: "primary",
  apiKey: "sk-ant-test",
  priority: 100,
  cooldownUntil: null,
  lastError: null,
  credentialDecryptFailed: false,
};

test("anthropic requests go to /v1/messages with x-api-key and anthropic-version", async () => {
  let seenUrl = "";
  let seenHeaders: Headers | null = null;
  const fakeFetch: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenHeaders = new Headers(init?.headers);
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await execute(
    {
      provider: anthropicProvider,
      connection: anthropicConnection,
      body: { model: "claude-sonnet-4-6" },
      signal: new AbortController().signal,
    },
    fakeFetch
  );
  assert.equal(seenUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(seenHeaders?.get("x-api-key"), "sk-ant-test");
  assert.equal(seenHeaders?.get("anthropic-version"), "2023-06-01");
  assert.equal(seenHeaders?.get("authorization"), null, "must NOT send a Bearer header");
});

test("openai requests are unchanged by the wire descriptor", async () => {
  let seenUrl = "";
  let seenHeaders: Headers | null = null;
  const fakeFetch: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenHeaders = new Headers(init?.headers);
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await execute(
    { provider, connection, body: { model: "gpt-4" }, signal: new AbortController().signal },
    fakeFetch
  );
  assert.equal(seenUrl, "https://api.openai.com/v1/chat/completions");
  assert.equal(seenHeaders?.get("authorization"), "Bearer sk-test");
  assert.equal(seenHeaders?.get("anthropic-version"), null);
  assert.equal(seenHeaders?.get("x-api-key"), null);
});

test("529 is retryable — Anthropic's overload status", () => {
  assert.equal(classifyStatus(529).retryable, true);
});

test("execute surfaces retry-after as milliseconds", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response("slow down", { status: 429, headers: { "retry-after": "7" } });
  const res = await execute(
    {
      provider: anthropicProvider,
      connection: anthropicConnection,
      body: {},
      signal: new AbortController().signal,
    },
    fakeFetch
  );
  assert.equal(res.retryable, true);
  assert.equal(res.retryAfterMs, 7000);
});

test("execute reports null retryAfterMs when the header is absent or unparseable", async () => {
  const noHeader: typeof fetch = async () => new Response("boom", { status: 503 });
  const bad: typeof fetch = async () =>
    new Response("boom", { status: 503, headers: { "retry-after": "soon" } });
  for (const impl of [noHeader, bad]) {
    const res = await execute(
      {
        provider: anthropicProvider,
        connection: anthropicConnection,
        body: {},
        signal: new AbortController().signal,
      },
      impl
    );
    assert.equal(res.retryAfterMs, null);
  }
});

test("cooldownMsFor prefers an upstream retry-after hint over backoff", () => {
  assert.equal(cooldownMsFor(429, 0, 7000), 7000);
  // Still capped at five minutes, so a hostile header cannot park a connection forever.
  assert.equal(cooldownMsFor(429, 0, 999_999_999), 300000);
  // No hint: unchanged exponential behaviour.
  assert.equal(cooldownMsFor(429, 0, null), 3000);
  assert.equal(cooldownMsFor(429, 2, null), 12000);
});

test("describeWire returns a descriptor for every registered wire format", () => {
  for (const fmt of ["openai", "anthropic", "gemini"] as const) {
    assert.ok(describeWire(fmt), `${fmt} must have a descriptor`);
  }
});

const geminiProvider: Provider = {
  id: "google",
  name: "Google",
  kind: "apikey",
  baseUrl: "https://generativelanguage.googleapis.com",
  wireFormat: "gemini",
  enabled: true,
};

const geminiConnection: Connection = {
  id: 3,
  providerId: "google",
  label: "primary",
  apiKey: "gk-1",
  priority: 100,
  cooldownUntil: null,
  lastError: null,
  credentialDecryptFailed: false,
};

test("gemini buildPath produces the non-streaming generateContent URL", () => {
  const desc = WIRE_DESCRIPTORS.gemini;
  assert.ok(desc?.buildPath, "gemini descriptor must expose buildPath");
  assert.equal(
    desc.buildPath({ model: "gemini-2.0-flash", stream: false }),
    "/v1beta/models/gemini-2.0-flash:generateContent"
  );
});

test("gemini buildPath produces the streaming URL with alt=sse", () => {
  const desc = WIRE_DESCRIPTORS.gemini;
  assert.equal(
    desc?.buildPath?.({ model: "gemini-2.0-flash", stream: true }),
    "/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse"
  );
});

test("gemini authHeaders use x-goog-api-key, not Bearer", () => {
  const headers = WIRE_DESCRIPTORS.gemini?.authHeaders("KEY123");
  assert.deepEqual(headers, { "x-goog-api-key": "KEY123" });
});

test("execute builds the NON-streaming gemini URL when params.stream is false", async () => {
  let calledUrl = "";
  const fetchImpl: typeof fetch = async (url) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({ candidates: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await execute(
    {
      provider: geminiProvider,
      connection: geminiConnection,
      // NB: no `stream` in the body — the Gemini converter strips it; the flag comes from params.
      body: { contents: [] },
      signal: new AbortController().signal,
      model: "gemini-2.0-flash",
      stream: false,
    },
    fetchImpl
  );
  assert.equal(result.ok, true);
  assert.equal(
    calledUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
  );
});

test("execute builds the STREAMING gemini URL when params.stream is true, NOT from body.stream", async () => {
  let calledUrl = "";
  const fetchImpl: typeof fetch = async (url) => {
    calledUrl = String(url);
    return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  await execute(
    {
      provider: geminiProvider,
      connection: geminiConnection,
      // body.stream is ABSENT (converter strips it). The streaming URL must still be chosen,
      // proving buildPath reads params.stream and not body.stream — this is the regression guard
      // for the "streaming URL never selected" bug.
      body: { contents: [] },
      signal: new AbortController().signal,
      model: "gemini-2.0-flash",
      stream: true,
    },
    fetchImpl
  );
  assert.equal(
    calledUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse"
  );
});
