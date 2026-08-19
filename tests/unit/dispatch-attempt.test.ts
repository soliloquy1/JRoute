import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-dispatch-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider, getProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { dispatchWithFailover } = await import("../../jroute/dispatchAttempt.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

upsertProvider({
  id: "openai",
  name: "OpenAI",
  kind: "apikey",
  baseUrl: "https://api.openai.com/v1",
  wireFormat: "openai",
  enabled: true,
});
const provider = getProvider("openai")!;

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    provider,
    providerId: "openai",
    upstreamModel: "gpt-5.6-sol",
    upstreamBody: { model: "gpt-5.6-sol", messages: [] },
    clientWantsStream: false,
    signal: new AbortController().signal,
    tokenResolver: () => null,
    requestId: "test-req",
    fetchImpl: fetch,
    ...overrides,
  };
}

test("returns ok:false with no candidates when no connections exist", async () => {
  getDb().prepare("DELETE FROM connections").run();
  const result = await dispatchWithFailover(baseParams());
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.status, 503);
    assert.equal(result.message, "No available connection");
    // The zero-candidate path must stay distinguishable from a post-attempt failure:
    // handleChat.ts answers it bare, with no usage_logs row.
    assert.equal(result.noCandidates, true);
  }
});

test("returns ok:true on a successful dial", async () => {
  getDb().prepare("DELETE FROM connections").run();
  createConnection("openai", "primary", "sk-test");
  const fetchImpl = async () =>
    new Response(JSON.stringify({ id: "x", choices: [{ message: { content: "hi" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const result = await dispatchWithFailover(
    baseParams({ requestId: "test-req-2", fetchImpl: fetchImpl as unknown as typeof fetch })
  );
  assert.equal(result.ok, true);
  if (result.ok === true) {
    assert.equal(result.result.ok, true);
    assert.equal(result.result.status, 200);
  }
});

test("propagates a client abort as clientAborted:true, not a normal failure", async () => {
  getDb().prepare("DELETE FROM connections").run();
  createConnection("openai", "primary", "sk-test");
  const controller = new AbortController();
  const fetchImpl = async () => {
    controller.abort();
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    throw err;
  };
  const result = await dispatchWithFailover(
    baseParams({
      signal: controller.signal,
      requestId: "test-req-3",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
  );
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.clientAborted, true);
    // The client-hangup contract: never conflated with the no-candidate path.
    assert.equal(result.noCandidates, false);
  }
});

test("a genuine transport failure (status 0, non-null message) is NOT treated as a client abort", async () => {
  getDb().prepare("DELETE FROM connections").run();
  createConnection("openai", "primary", "sk-test");
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };
  const result = await dispatchWithFailover(
    baseParams({ requestId: "test-req-4", fetchImpl: fetchImpl as unknown as typeof fetch })
  );
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.clientAborted, false);
    assert.notEqual(result.message, "");
  }
});
