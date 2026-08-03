// tests/unit/executor.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execute, classifyStatus, cooldownMsFor } from "../../jroute/executor.ts";
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
