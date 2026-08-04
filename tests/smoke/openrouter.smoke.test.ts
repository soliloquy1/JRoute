// tests/smoke/openrouter.smoke.test.ts
//
// Env-gated real-network test. Runs only when BOTH are set:
//   JROUTE_SMOKE=1
//   OPENROUTER_API_KEY=<key>
// Never runs in `npm test`.
//
// Scope: OpenRouter normalizes all responses to OpenAI Chat Completions shape, so this
// exercises the OPENAI path only. It validates the Plan 1 pipeline against a real
// upstream — real network timing, real SSE chunk boundaries, real keepalive interaction.
// It does NOT exercise or de-risk the Anthropic converter.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENABLED = process.env.JROUTE_SMOKE === "1" && !!process.env.OPENROUTER_API_KEY;
const FREE_MODEL = process.env.JROUTE_SMOKE_MODEL ?? "gpt-4o-mini";

const dir = mkdtempSync(join(tmpdir(), "jroute-smoke-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { issueApiKey } = await import("../../src/lib/auth/apiKeys.ts");
const chat = await import("../../src/app/api/v1/chat/completions/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

function seedOpenRouter(): string {
  upsertProvider({
    id: "openai",
    name: "OpenRouter",
    kind: "apikey",
    baseUrl: "https://openrouter.ai/api/v1",
    wireFormat: "openai",
    enabled: true,
  });
  createConnection("openai", "smoke", process.env.OPENROUTER_API_KEY as string);
  return issueApiKey("smoke").secret;
}

const post = (secret: string, body: unknown) =>
  new Request("https://x/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

test(
  "non-streaming request reaches a real provider and returns content",
  { skip: !ENABLED },
  async () => {
    const secret = seedOpenRouter();
    const res = await chat.POST(
      post(secret, {
        model: FREE_MODEL,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      })
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    assert.ok(body.choices?.[0]?.message?.content, "a real provider must return message content");
  }
);

test("streaming request relays real SSE frames", { skip: !ENABLED }, async () => {
  const secret = seedOpenRouter();
  const res = await chat.POST(
    post(secret, {
      model: FREE_MODEL,
      stream: true,
      messages: [{ role: "user", content: "Count to three." }],
    })
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  assert.equal(res.headers.get("x-accel-buffering"), "no");

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  assert.ok(out.includes("data: "), "must relay SSE data frames");
  assert.ok(out.includes("[DONE]"), "must relay the terminating frame");
});
