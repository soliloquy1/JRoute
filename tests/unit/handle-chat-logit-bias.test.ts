// tests/unit/handle-chat-logit-bias.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-logit-bias-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { issueApiKey, verifyApiKey, setApiKeyLogitBiasPreset } =
  await import("../../src/lib/auth/apiKeys.ts");
const { createLogitBiasPreset } = await import("../../src/lib/db/logitBiasPresets.ts");
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
  db.prepare("DELETE FROM logit_bias_presets").run();
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

async function keyWithBiasPreset(): Promise<ReturnType<typeof verifyApiKey>> {
  const biasId = createLogitBiasPreset("No Suddenly", [{ text: "suddenly", value: -80 }]);
  const issued = issueApiKey("janitor");
  setApiKeyLogitBiasPreset(issued.id, biasId);
  return verifyApiKey(issued.secret);
}

test("handleChat injects logit_bias into the upstream body for an openai-wireFormat target", async () => {
  createConnection("openai", "primary", "sk-test");
  const apiKey = await keyWithBiasPreset();
  let capturedBody: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "x", choices: [], usage: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await handleChat(
    post({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    apiKey!,
    { fetchImpl }
  );
  assert.ok(capturedBody);
  assert.deepEqual(capturedBody!.logit_bias, { "82": -80, "44806": -80 });
});

test("handleChat does not inject logit_bias for a non-openai wireFormat target", async () => {
  createConnection("anthropic", "primary", "sk-test");
  const apiKey = await keyWithBiasPreset();
  let capturedBody: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "x", type: "message", content: [], usage: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await handleChat(
    post({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }),
    apiKey!,
    { fetchImpl }
  );
  assert.ok(capturedBody);
  assert.equal(capturedBody!.logit_bias, undefined);
});
