// tests/unit/handle-chat-reasoning-tags.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-reasoning-tags-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { issueApiKey, verifyApiKey, setApiKeyRichPreset } = await import(
  "../../src/lib/auth/apiKeys.ts"
);
const { createRichPreset } = await import("../../src/lib/db/richPresets.ts");
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
  db.prepare("DELETE FROM rich_presets").run();
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

const MINIMAL_RAW = { prompts: [{ identifier: "p1" }], prompt_order: [] };

test("handleChat strips a reasoning block from a non-streaming response", async () => {
  createConnection("openai", "primary", "sk-test");
  const richId = createRichPreset("Izumi", MINIMAL_RAW, {
    reasoningTags: [{ openTag: "<konatan_planning~>", closeTag: "</konatan_planning~>" }],
  });
  const issued = issueApiKey("janitor");
  setApiKeyRichPreset(issued.id, richId);
  const apiKey = verifyApiKey(issued.secret);
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        id: "x",
        choices: [
          {
            message: {
              role: "assistant",
              content: "<konatan_planning~>internal plan</konatan_planning~>the actual reply",
            },
          },
        ],
        usage: {},
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const res = await handleChat(post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }), apiKey!, {
    fetchImpl,
  });
  const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  assert.equal(body.choices[0].message.content, "the actual reply");
});

test("handleChat skips reasoning-tag stripping entirely when the assigned preset has none configured", async () => {
  createConnection("openai", "primary", "sk-test");
  const richId = createRichPreset("Plain", MINIMAL_RAW);
  const issued = issueApiKey("no-tags");
  setApiKeyRichPreset(issued.id, richId);
  const apiKey = verifyApiKey(issued.secret);
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        id: "x",
        choices: [{ message: { role: "assistant", content: "<konatan_planning~>x</konatan_planning~>y" } }],
        usage: {},
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const res = await handleChat(post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }), apiKey!, {
    fetchImpl,
  });
  const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  assert.equal(body.choices[0].message.content, "<konatan_planning~>x</konatan_planning~>y");
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

test("handleChat strips a reasoning block from a streaming response", async () => {
  createConnection("openai", "primary", "sk-test");
  const richId = createRichPreset("Izumi", MINIMAL_RAW, {
    reasoningTags: [{ openTag: "<konatan_planning~>", closeTag: "</konatan_planning~>" }],
  });
  const issued = issueApiKey("janitor-stream");
  setApiKeyRichPreset(issued.id, richId);
  const apiKey = verifyApiKey(issued.secret);
  const fetchImpl: typeof fetch = async () =>
    new Response(
      sseBytes([
        openaiChunk("<konatan_planning~>internal plan</konatan_planning~>the reply"),
        openaiChunk("", "stop"),
        "data: [DONE]\n\n",
      ]),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  const res = await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true }),
    apiKey!,
    { fetchImpl }
  );
  const text = await res.text();
  assert.ok(!text.includes("konatan_planning"));
  assert.match(text, /the reply/);
});
