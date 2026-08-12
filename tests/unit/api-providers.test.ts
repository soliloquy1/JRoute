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
        id: "openai",
        name: "OpenAI",
        kind: "apikey",
        baseUrl: "https://api.openai.com/v1",
        wireFormat: "openai",
        enabled: true,
      }),
    })
  );
  assert.equal(res.status, 200);
  assert.equal(getProvider("openai")?.name, "OpenAI");
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

test("DELETE /api/providers/:id removes the provider", async () => {
  const res = await providerById.DELETE(
    new Request("https://x/api/providers/openai", { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ id: "openai" }) }
  );
  assert.equal(res.status, 200);
  assert.equal(getProvider("openai"), null);
});
