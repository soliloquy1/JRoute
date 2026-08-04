// tests/unit/routes.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

// The route calls handleChat WITHOUT deps, so it uses handleChat's own DEFAULTS. That
// object literal (`{ fetchImpl: fetch, ... }`) captures the `fetch` reference EAGERLY at
// module-evaluation time — verified by probe — so swapping globalThis.fetch after the
// import below would be ignored. Install a permanent trampoline first that forwards to a
// mutable holder, so each test can swap the behaviour without re-importing the module.
let fetchStub: typeof fetch = async () =>
  new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = ((...args: Parameters<typeof fetch>) => fetchStub(...args)) as typeof fetch;

const { resetDb, getDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { issueApiKey } = await import("../../src/lib/auth/apiKeys.ts");
const chat = await import("../../src/app/api/v1/chat/completions/route.ts");
const models = await import("../../src/app/api/v1/models/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const seedOpenAi = () =>
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });

test("OPTIONS preflight succeeds without credentials", async () => {
  const res = await chat.OPTIONS(
    new Request("https://x/v1/chat/completions", { method: "OPTIONS" })
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("POST without an API key is 401 and leaks nothing", async () => {
  const res = await chat.POST(
    new Request("https://x/v1/chat/completions", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { message: string } };
  assert.ok(!body.error.message.includes("at /"));
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

// Important 1: the success path is the ONLY path that carries Janitor's actual replies,
// and nothing covered it. Deleting the header-merge loop in the route left every other
// test in this file and all 14 handle-chat tests green, while making every successful
// reply an opaque CORS error in the browser. Streaming is asserted here because it
// covers both risks at once: that CORS is applied, and that applying it does not
// clobber the SSE headers (the loop must write only Access-Control-* keys).
test("a SUCCESSFUL streaming POST carries BOTH CORS and its SSE headers", async () => {
  seedOpenAi();
  createConnection("openai", "stream-conn", "sk-stream");
  const encoder = new TextEncoder();
  fetchStub = async () =>
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

  const { secret } = issueApiKey("janitor-stream");
  const res = await chat.POST(
    new Request("https://x/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    })
  );

  assert.equal(res.status, 200);
  // The CORS half — this is what the deleted-line mutant kills.
  assert.equal(
    res.headers.get("access-control-allow-origin"),
    "*",
    "a successful reply must carry CORS or the browser rejects it"
  );
  // The no-clobber half — the merge must not overwrite the streaming headers.
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  assert.equal(res.headers.get("x-accel-buffering"), "no");
  // And the stream must actually still deliver.
  const text = await res.text();
  assert.match(text, /data: \{"delta":"hi"\}/);
});

// Minor 5: a throw from the DB layer must not reach Next's default 500, which carries no
// CORS headers (browser shows an opaque CORS failure; a dev build renders a stack).
// The throw is injected via a synchronous-throwing req.json(): handleChat's guard is
// `await req.json().catch(...)`, and .catch cannot intercept a SYNCHRONOUS throw, so this
// escapes handleChat exactly like a getProvider/listConnections/logUsage failure would.
test("an unexpected throw inside handleChat becomes a 500 WITH CORS and no leak", async () => {
  const { secret } = issueApiKey("janitor-throw");
  const req = new Request("https://x/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
  });
  // Payload carries a stack frame, an absolute path and a key so the assertions below
  // prove the catch does not pass the error text through into the body.
  Object.defineProperty(req, "json", {
    value: () => {
      throw new Error(
        "SQLITE_CORRUPT at /srv/omniroute/src/lib/db/usageLogs.ts:42:7 key=sk-abcdef1234567890"
      );
    },
  });

  const res = await chat.POST(req);
  assert.equal(res.status, 500);
  assert.equal(
    res.headers.get("access-control-allow-origin"),
    "*",
    "a 500 must still carry CORS or the browser hides it behind a CORS error"
  );
  const body = (await res.json()) as { error: { message: string } };
  assert.ok(!body.error.message.includes("at /"), "must not leak a stack frame");
  assert.ok(!body.error.message.includes("/srv/"), "must not leak an absolute path");
  assert.ok(!body.error.message.includes("sk-abcdef"), "must not leak a credential");
  assert.ok(!body.error.message.includes("SQLITE_CORRUPT"), "must not leak internals");
});

test("GET /v1/models lists enabled providers' model ids", async () => {
  seedOpenAi();
  createConnection("openai", "test-conn", "sk-test");
  const res = await models.GET(new Request("https://x/v1/models"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { object: string; data: Array<{ id: string }> };
  assert.equal(body.object, "list");
  assert.ok(body.data.some((m) => m.id === "gpt-4o"));
});

// Important 2: without the enabled check the route advertises every model from disabled
// providers to any anonymous caller. The test above seeds an enabled provider with a
// connection and asserts model presence. This test adds a disabled provider with a
// connection to ensure disabled providers' models are not advertised.
test("GET /v1/models OMITS models from disabled providers", async () => {
  seedOpenAi();
  createConnection("openai", "test-conn", "sk-test");
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: false,
  });
  createConnection("anthropic", "disabled-conn", "sk-ant-test");
  const res = await models.GET(new Request("https://x/v1/models"));
  const body = (await res.json()) as { data: Array<{ id: string }> };
  assert.ok(
    body.data.some((m) => m.id === "gpt-4o"),
    "enabled providers must still list their models"
  );
  assert.ok(
    !body.data.some((m) => m.id === "claude-sonnet-4-6"),
    "disabled providers must not list their models"
  );
});

// Minor 3: pin the row shape. Clients key off `object: "model"`; mutating the literals
// left every other assertion green.
test("GET /v1/models emits the exact model row shape for OpenAI", async () => {
  seedOpenAi();
  createConnection("openai", "test-conn", "sk-test");
  const res = await models.GET(new Request("https://x/v1/models"));
  const body = (await res.json()) as { data: Array<Record<string, unknown>> };
  // Scoped by a bound id: providers accumulate across tests in this file (no truncating
  // hook), so an unscoped data[0] would read whichever row sorted first.
  const row = body.data.find((m) => m.id === "gpt-4o");
  assert.deepEqual(row, { id: "gpt-4o", object: "model", owned_by: "jroute" });
});

test("GET /v1/models lists real model ids, not provider ids", async () => {
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
  createConnection("anthropic", "primary", "sk-ant-test");

  const res = await models.GET(new Request("https://x/v1/models"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { object: string; data: Array<{ id: string }> };
  const ids = body.data.map((m) => m.id);

  assert.ok(ids.includes("claude-sonnet-4-6"), "a real model id must be advertised");
  assert.ok(!ids.includes("anthropic"), "provider ids must NOT be advertised as models");
});

test("GET /v1/models omits models whose provider has no connection", async () => {
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
  // No connection created.

  const res = await models.GET(new Request("https://x/v1/models"));
  const body = (await res.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(body.data, [], "a provider with no connection advertises nothing");
});

test("GET /v1/models omits models whose provider is disabled", async () => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: false,
  });
  createConnection("anthropic", "primary", "sk-ant-test");

  const res = await models.GET(new Request("https://x/v1/models"));
  const body = (await res.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(body.data, []);
});

test("GET /v1/models emits the exact OpenAI model row shape", async () => {
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
  createConnection("anthropic", "primary", "sk-ant-test");

  const res = await models.GET(new Request("https://x/v1/models"));
  const body = (await res.json()) as {
    object: string;
    data: Array<Record<string, unknown>>;
  };
  assert.equal(body.object, "list");
  const row = body.data.find((m) => m.id === "claude-sonnet-4-6");
  assert.deepEqual(row, { id: "claude-sonnet-4-6", object: "model", owned_by: "jroute" });
});
