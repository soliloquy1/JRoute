// tests/unit/handle-chat-regex-presets.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-regex-presets-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { issueApiKey, verifyApiKey, setApiKeyRegexPreset } = await import(
  "../../src/lib/auth/apiKeys.ts"
);
const { createRegexPreset } = await import("../../src/lib/db/regexPresets.ts");
const { warmUpSandbox } = await import("../../src/lib/lorebooks/sandbox.ts");
const { handleChat } = await import("../../jroute/handleChat.ts");
const { RegexScriptSchema } = await import("../../src/lib/prompts/regexScriptSchema.ts");

await warmUpSandbox();

// Build a fully-typed RegexScript from a partial literal (schema only requires a
// non-empty findRegex string; typing-only helper).
function s(obj: Record<string, unknown>) {
  return RegexScriptSchema.parse(obj) as import("../../src/lib/prompts/regexScriptSchema.ts").RegexScript;
}

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  db.prepare("DELETE FROM regex_presets").run();
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com/v1",
    wireFormat: "anthropic",
    enabled: true,
  });
});

const post = (body: unknown) =>
  new Request("https://x/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("handleChat applies a regex preset to only the last user message before forwarding upstream", async () => {
  createConnection("openai", "primary", "sk-test");
  const presetId = createRegexPreset("Strip secret", [
    s({ scriptName: "s", findRegex: "/secret/", replaceString: "[redacted]", placement: [1, 2] }),
  ]);
  const issued = issueApiKey("janitor");
  setApiKeyRegexPreset(issued.id, presetId);
  const apiKey = verifyApiKey(issued.secret);
  let capturedBody: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ id: "x", choices: [{ message: { content: "ok" } }], usage: {} }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  await handleChat(
    post({
      model: "gpt-4o",
      messages: [
        { role: "user", content: "an old secret" },
        { role: "assistant", content: "..." },
        { role: "user", content: "the secret word" },
      ],
    }),
    apiKey!,
    { fetchImpl }
  );
  const messages = capturedBody!.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0].content, "an old secret");
  assert.equal(messages[2].content, "the [redacted] word");
});

test("handleChat skips the user-input transform entirely when the key has no regex preset", async () => {
  createConnection("openai", "primary", "sk-test");
  const issued = issueApiKey("no-preset");
  const apiKey = verifyApiKey(issued.secret);
  let capturedBody: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ id: "x", choices: [{ message: { content: "ok" } }], usage: {} }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "the secret word" }] }),
    apiKey!,
    { fetchImpl }
  );
  const messages = capturedBody!.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0].content, "the secret word");
});

test("handleChat applies a regex preset to the assistant message content for a non-streaming response", async () => {
  createConnection("openai", "primary", "sk-test");
  const presetId = createRegexPreset("Upper", [
    s({ scriptName: "s", findRegex: "/hello/", replaceString: "HI", placement: [2] }),
  ]);
  const issued = issueApiKey("janitor-out");
  setApiKeyRegexPreset(issued.id, presetId);
  const apiKey = verifyApiKey(issued.secret);
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        id: "x",
        choices: [{ message: { role: "assistant", content: "hello there" } }],
        usage: {},
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    apiKey!,
    { fetchImpl }
  );
  const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  assert.equal(body.choices[0].message.content, "HI there");
});

function sseBytes(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= frames.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(frames[i]));
      i += 1;
    },
  });
}

function openaiChunk(content: string, finish: string | null = null): string {
  const payload = {
    id: "c",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o",
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

test("handleChat applies a regex preset to a streaming openai-wireFormat response", async () => {
  createConnection("openai", "primary", "sk-test");
  const presetId = createRegexPreset("Redact", [
    s({ scriptName: "s", findRegex: "/secret/", replaceString: "[redacted]", placement: [2] }),
  ]);
  const issued = issueApiKey("janitor-stream-openai");
  setApiKeyRegexPreset(issued.id, presetId);
  const apiKey = verifyApiKey(issued.secret);
  const fetchImpl: typeof fetch = async () =>
    new Response(sseBytes([openaiChunk("the secret"), openaiChunk("", "stop"), "data: [DONE]\n\n"]), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true }),
    apiKey!,
    { fetchImpl }
  );
  const text = await res.text();
  assert.match(text, /\[redacted\]/);
});

test("handleChat applies a regex preset to a streaming anthropic-wireFormat response", async () => {
  createConnection("anthropic", "primary", "sk-test");
  const presetId = createRegexPreset("Redact2", [
    s({ scriptName: "s", findRegex: "/secret/", replaceString: "[redacted]", placement: [2] }),
  ]);
  const issued = issueApiKey("janitor-stream-anthropic");
  setApiKeyRegexPreset(issued.id, presetId);
  const apiKey = verifyApiKey(issued.secret);
  const frames = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { id: "m1", usage: {} },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "the secret" },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 2 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
  const fetchImpl: typeof fetch = async () =>
    new Response(sseBytes(frames), { status: 200, headers: { "content-type": "text/event-stream" } });
  const res = await handleChat(
    post({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], stream: true }),
    apiKey!,
    { fetchImpl }
  );
  const text = await res.text();
  assert.match(text, /\[redacted\]/);
});

test("handleChat does not wrap the stream when the key has no active output scripts", async () => {
  createConnection("openai", "primary", "sk-test");
  const issued = issueApiKey("janitor-no-wrap");
  const apiKey = verifyApiKey(issued.secret);
  const fetchImpl: typeof fetch = async () =>
    new Response(sseBytes([openaiChunk("hi"), openaiChunk("", "stop"), "data: [DONE]\n\n"]), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true }),
    apiKey!,
    { fetchImpl }
  );
  const text = await res.text();
  assert.match(text, /"content":"hi"/);
});
