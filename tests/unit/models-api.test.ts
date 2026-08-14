// tests/unit/models-api.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-models-api-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { resetDb, getDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { modelExists } = await import("../../src/lib/db/models.ts");

const modelsRoute = await import("../../src/app/api/models/route.ts");
const modelByIdRoute = await import(
  "../../src/app/api/models/[providerId]/[modelId]/route.ts"
);
const importRoute = await import("../../src/app/api/providers/[id]/import-models/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM providers").run();
  getDb().prepare("DELETE FROM models").run();
  getDb().prepare("DELETE FROM connections").run();
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = {
  cookie: `jroute_session=${token}`,
  "content-type": "application/json",
};

const seed = (id: string, wireFormat: "openai" | "anthropic" | "gemini" = "openai") =>
  upsertProvider({
    id,
    name: id,
    kind: "apikey",
    baseUrl: `https://${id}.example`,
    wireFormat,
    enabled: true,
    modelPrefix: "",
  });

test("POST /api/models without a session is 401", async () => {
  const res = await modelsRoute.POST(new Request("https://x/api/models", { method: "POST", body: "{}" }));
  assert.equal(res.status, 401);
});

test("POST /api/models creates a model", async () => {
  seed("openai");
  const res = await modelsRoute.POST(
    new Request("https://x/api/models", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ providerId: "openai", modelId: "gpt-custom", maxTokens: 16384 }),
    })
  );
  assert.equal(res.status, 200);
  assert.equal(modelExists("openai", "gpt-custom"), true);
});

test("POST /api/models rejects duplicate", async () => {
  seed("openai");
  await modelsRoute.POST(
    new Request("https://x/api/models", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ providerId: "openai", modelId: "gpt-custom" }),
    })
  );
  const res = await modelsRoute.POST(
    new Request("https://x/api/models", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ providerId: "openai", modelId: "gpt-custom" }),
    })
  );
  assert.equal(res.status, 409);
});

test("POST /api/models 404s for unknown provider", async () => {
  const res = await modelsRoute.POST(
    new Request("https://x/api/models", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ providerId: "ghost", modelId: "x" }),
    })
  );
  assert.equal(res.status, 404);
});

test("PATCH /api/models/:p/:m toggles enabled, DELETE removes", async () => {
  seed("openai");
  await modelsRoute.POST(
    new Request("https://x/api/models", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ providerId: "openai", modelId: "gpt-custom" }),
    })
  );
  const patch = await modelByIdRoute.PATCH(
    new Request("https://x/api/models/openai/gpt-4o", {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ enabled: false }),
    }),
    { params: Promise.resolve({ providerId: "openai", modelId: "gpt-custom" }) }
  );
  assert.equal(patch.status, 200);
  const del = await modelByIdRoute.DELETE(
    new Request("https://x/api/models/openai/gpt-4o", { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ providerId: "openai", modelId: "gpt-custom" }) }
  );
  assert.equal(del.status, 200);
  assert.equal(modelExists("openai", "gpt-custom"), false);
});

test("import-models refuses anthropic", async () => {
  seed("anthropic", "anthropic");
  const res = await importRoute.POST(
    new Request("https://x/api/providers/anthropic/import-models", {
      method: "POST",
      headers: authHeaders,
    }),
    { params: Promise.resolve({ id: "anthropic" }) }
  );
  assert.equal(res.status, 400);
});

test("import-models requires a connection with an api key", async () => {
  seed("openai");
  const res = await importRoute.POST(
    new Request("https://x/api/providers/openai/import-models", {
      method: "POST",
      headers: authHeaders,
    }),
    { params: Promise.resolve({ id: "openai" }) }
  );
  assert.equal(res.status, 400);
});

test("import-models pulls and stores openai models", async () => {
  seed("openai");
  createConnection("openai", "main", "sk-test");
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }] }),
  })) as unknown as typeof fetch;
  try {
    const res = await importRoute.POST(
      new Request("https://x/api/providers/openai/import-models", {
        method: "POST",
        headers: authHeaders,
      }),
      { params: Promise.resolve({ id: "openai" }) }
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { imported: number; total: number };
    assert.equal(body.imported, 2);
    assert.equal(body.total, 2);
    assert.equal(modelExists("openai", "gpt-4.1"), true);
  } finally {
    globalThis.fetch = original;
  }
});

test("POST /api/models accepts a gateway-style modelId containing '/'", async () => {
  seed("openrouter");
  const res = await modelsRoute.POST(
    new Request("https://x/api/models", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ providerId: "openrouter", modelId: "openai/gpt-4o" }),
    })
  );
  assert.equal(res.status, 200);
  assert.equal(modelExists("openrouter", "openai/gpt-4o"), true);
});

test("import-models pulls OpenRouter-style ids that contain '/'", async () => {
  seed("openrouter");
  createConnection("openrouter", "main", "sk-or-test");
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ id: "openai/gpt-4o" }, { id: "meta-llama/llama-3.1-70b-instruct" }],
    }),
  })) as unknown as typeof fetch;
  try {
    const res = await importRoute.POST(
      new Request("https://x/api/providers/openrouter/import-models", {
        method: "POST",
        headers: authHeaders,
      }),
      { params: Promise.resolve({ id: "openrouter" }) }
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { imported: number; total: number };
    assert.equal(body.imported, 2);
    assert.equal(body.total, 2);
    assert.equal(modelExists("openrouter", "openai/gpt-4o"), true);
    assert.equal(modelExists("openrouter", "meta-llama/llama-3.1-70b-instruct"), true);
  } finally {
    globalThis.fetch = original;
  }
});

test("import-models pulls gemini models (strips models/ prefix)", async () => {
  seed("google", "gemini");
  createConnection("google", "main", "key-test");
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ models: [{ name: "models/gemini-1.5-flash" }] }),
  })) as unknown as typeof fetch;
  try {
    const res = await importRoute.POST(
      new Request("https://x/api/providers/google/import-models", {
        method: "POST",
        headers: authHeaders,
      }),
      { params: Promise.resolve({ id: "google" }) }
    );
    assert.equal(res.status, 200);
    assert.equal(modelExists("google", "gemini-2.0-flash"), true);
  } finally {
    globalThis.fetch = original;
  }
});
