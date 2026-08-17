// tests/unit/handle-chat-fallback-strategy.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-fallback-e2e-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { createModel } = await import("../../src/lib/db/models.ts");
const { issueApiKey, verifyApiKey } = await import("../../src/lib/auth/apiKeys.ts");
const { setFallbackStrategy } = await import("../../src/lib/db/settings.ts");
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
  db.prepare("DELETE FROM usage_logs").run();
  db.prepare("DELETE FROM settings").run();
  db.prepare("DELETE FROM provider_routing_state").run();
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
  createModel("openai", "gpt-4o");
});

const post = (body: unknown) =>
  new Request("https://x/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const key = () => verifyApiKey(issueApiKey("janitor").secret)!;

const okFetch: typeof fetch = async () =>
  new Response(JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("priority strategy always tries the lowest-priority connection first", async () => {
  createConnection("openai", "a", "sk-a", { priority: 1 });
  createConnection("openai", "b", "sk-b", { priority: 2 });

  const dialedKeys: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    dialedKeys.push(new Headers(init?.headers).get("authorization") ?? "");
    return okFetch(_url, init);
  };

  await handleChat(post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }), key(), { fetchImpl });
  await handleChat(post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }), key(), { fetchImpl });

  assert.deepEqual(dialedKeys, ["Bearer sk-a", "Bearer sk-a"], "always dials the same lowest-priority connection first");
});

test("round-robin strategy rotates the first-dialed connection across requests", async () => {
  setFallbackStrategy("round-robin");
  createConnection("openai", "a", "sk-a", { priority: 1 });
  createConnection("openai", "b", "sk-b", { priority: 2 });

  const dialedKeys: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    dialedKeys.push(new Headers(init?.headers).get("authorization") ?? "");
    return okFetch(_url, init);
  };

  await handleChat(post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }), key(), { fetchImpl });
  await handleChat(post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }), key(), { fetchImpl });
  await handleChat(post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }), key(), { fetchImpl });

  assert.deepEqual(
    dialedKeys,
    ["Bearer sk-a", "Bearer sk-b", "Bearer sk-a"],
    "rotates first pick: a (no cursor) -> b (after a) -> a (after b)"
  );
});
