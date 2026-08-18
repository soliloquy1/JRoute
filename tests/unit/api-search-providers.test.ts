// tests/unit/api-search-providers.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-api-search-providers-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { getSearchProvider, listSearchProviders } =
  await import("../../src/lib/db/searchProviders.ts");
const { getActiveSearchProviderId } = await import("../../src/lib/db/settings.ts");
const providers = await import("../../src/app/api/search-providers/route.ts");
const providerById = await import("../../src/app/api/search-providers/[id]/route.ts");
const active = await import("../../src/app/api/search-providers/active/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = { cookie: `jroute_session=${token}`, "content-type": "application/json" };

beforeEach(() => {
  getDb().prepare("DELETE FROM search_providers").run();
  getDb().prepare("DELETE FROM settings").run();
});

test("POST /api/search-providers without a session is 401", async () => {
  const res = await providers.POST(
    new Request("https://x/api/search-providers", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
});

test("POST creates a provider; GET lists it without the plaintext api key", async () => {
  const postRes = await providers.POST(
    new Request("https://x/api/search-providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ kind: "brave", label: "My Brave", apiKey: "brave-secret" }),
    })
  );
  assert.equal(postRes.status, 200);
  const { id } = (await postRes.json()) as { id: number };
  assert.equal(getSearchProvider(id)?.apiKey, "brave-secret", "stored value decrypts correctly");

  const getRes = await providers.GET(
    new Request("https://x/api/search-providers", { headers: authHeaders })
  );
  assert.equal(getRes.status, 200);
  const body = (await getRes.json()) as { providers: Array<Record<string, unknown>> };
  assert.equal(body.providers.length, 1);
  assert.equal(body.providers[0].label, "My Brave");
  assert.ok(!("apiKey" in body.providers[0]), "plaintext apiKey must never appear in the response");
  assert.equal(body.providers[0].apiKeyMasked, "••••cret");
});

test("POST with an invalid kind is 400", async () => {
  const res = await providers.POST(
    new Request("https://x/api/search-providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ kind: "carrier-pigeon", label: "x", apiKey: "k" }),
    })
  );
  assert.equal(res.status, 400);
});

test("PATCH /api/search-providers/:id updates the label", async () => {
  const postRes = await providers.POST(
    new Request("https://x/api/search-providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ kind: "brave", label: "Old", apiKey: "k" }),
    })
  );
  const { id } = (await postRes.json()) as { id: number };
  const patchRes = await providerById.PATCH(
    new Request(`https://x/api/search-providers/${id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ label: "New" }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(patchRes.status, 200);
  assert.equal(listSearchProviders().find((p) => p.id === id)?.label, "New");
});

test("DELETE /api/search-providers/:id removes it", async () => {
  const postRes = await providers.POST(
    new Request("https://x/api/search-providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ kind: "serpapi", label: "Gone", apiKey: "k" }),
    })
  );
  const { id } = (await postRes.json()) as { id: number };
  const delRes = await providerById.DELETE(
    new Request(`https://x/api/search-providers/${id}`, { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(delRes.status, 200);
  assert.equal(getSearchProvider(id), null);
});

test("PUT /api/search-providers/active sets and GET reflects the active provider id", async () => {
  const postRes = await providers.POST(
    new Request("https://x/api/search-providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ kind: "brave", label: "A", apiKey: "k" }),
    })
  );
  const { id } = (await postRes.json()) as { id: number };
  const putRes = await active.PUT(
    new Request("https://x/api/search-providers/active", {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ id }),
    })
  );
  assert.equal(putRes.status, 200);
  assert.equal(getActiveSearchProviderId(), id);

  const getRes = await active.GET(
    new Request("https://x/api/search-providers/active", { headers: authHeaders })
  );
  const body = (await getRes.json()) as { id: number | null };
  assert.equal(body.id, id);
});

test("PUT /api/search-providers/active with { id: null } clears the active provider", async () => {
  const postRes = await providers.POST(
    new Request("https://x/api/search-providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ kind: "brave", label: "A", apiKey: "k" }),
    })
  );
  const { id } = (await postRes.json()) as { id: number };
  await active.PUT(
    new Request("https://x/api/search-providers/active", {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ id }),
    })
  );
  await active.PUT(
    new Request("https://x/api/search-providers/active", {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ id: null }),
    })
  );
  assert.equal(getActiveSearchProviderId(), null);
});

test("a malformed POST body returns 400 with no stack trace in the message", async () => {
  const res = await providers.POST(
    new Request("https://x/api/search-providers", {
      method: "POST",
      headers: authHeaders,
      body: "{not json",
    })
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { message: string } };
  assert.ok(!body.error.message.includes("at /"), "must not leak a stack trace");
});
