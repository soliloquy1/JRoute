// tests/unit/api-connections-reorder.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection, listConnections } = await import("../../src/lib/db/connections.ts");
const reorder = await import("../../src/app/api/connections/reorder/route.ts");

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

upsertProvider({
  id: "openai",
  name: "OpenAI",
  kind: "apikey",
  baseUrl: "https://api.openai.com/v1",
  wireFormat: "openai",
  enabled: true,
});
const idA = createConnection("openai", "a", "sk-a");
const idB = createConnection("openai", "b", "sk-b");
const idC = createConnection("openai", "c", "sk-c");

test("POST /api/connections/reorder without a session is 401", async () => {
  const res = await reorder.POST(
    new Request("https://x/api/connections/reorder", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
});

test("POST /api/connections/reorder sets priority to array position", async () => {
  const res = await reorder.POST(
    new Request("https://x/api/connections/reorder", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ orderedIds: [idC, idA, idB] }),
    })
  );
  assert.equal(res.status, 200);
  const ordered = listConnections("openai");
  assert.deepEqual(
    ordered.map((c) => c.id),
    [idC, idA, idB]
  );
});
