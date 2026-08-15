// tests/unit/api-providers.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { getProvider } = await import("../../src/lib/db/providers.ts");
const providers = await import("../../src/app/api/providers/route.ts");
const providerById = await import("../../src/app/api/providers/[id]/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = {
  cookie: `jroute_session=${token}`,
  "content-type": "application/json",
};

test("POST /api/providers without a session is 401", async () => {
  const res = await providers.POST(
    new Request("https://x/api/providers", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
});

test("POST /api/providers with a session upserts a provider", async () => {
  const res = await providers.POST(
    new Request("https://x/api/providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: "custom-prov-1",
        name: "Custom Provider 1",
        kind: "apikey",
        baseUrl: "https://api.custom-provider-1.com/v1",
        wireFormat: "openai",
        enabled: true,
      }),
    })
  );
  assert.equal(res.status, 200);
  assert.equal(getProvider("custom-prov-1")?.name, "Custom Provider 1");
});

test("POST /api/providers with an invalid body is 400", async () => {
  const res = await providers.POST(
    new Request("https://x/api/providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ id: "x" }),
    })
  );
  assert.equal(res.status, 400);
});

test("POST /api/providers with an existing id and no overwrite is 409", async () => {
  const body = {
    id: "test-prov-1",
    name: "Test Provider 1",
    kind: "apikey",
    baseUrl: "https://api.test-provider-1.com/v1",
    wireFormat: "openai",
    enabled: true,
  };
  const first = await providers.POST(
    new Request("https://x/api/providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
    })
  );
  assert.equal(first.status, 200);
  const second = await providers.POST(
    new Request("https://x/api/providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ ...body, name: "Test Provider 1 (changed)" }),
    })
  );
  assert.equal(second.status, 409);
  assert.equal(getProvider("test-prov-1")?.name, "Test Provider 1");
});

test("POST /api/providers with an existing id and overwrite:true is 200", async () => {
  const body = {
    id: "test-prov-1",
    name: "Test Provider 1 (overwritten)",
    kind: "apikey",
    baseUrl: "https://api.test-provider-1.com/v1",
    wireFormat: "openai",
    enabled: true,
    overwrite: true,
  };
  const res = await providers.POST(
    new Request("https://x/api/providers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
    })
  );
  assert.equal(res.status, 200);
  assert.equal(getProvider("test-prov-1")?.name, "Test Provider 1 (overwritten)");
});

test("DELETE /api/providers/:id removes the provider", async () => {
  const res = await providerById.DELETE(
    new Request("https://x/api/providers/openai", { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ id: "openai" }) }
  );
  assert.equal(res.status, 200);
  assert.equal(getProvider("openai"), null);
});
