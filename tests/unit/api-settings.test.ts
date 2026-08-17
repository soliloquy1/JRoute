// tests/unit/api-settings.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-api-settings-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { getFallbackStrategy } = await import("../../src/lib/db/settings.ts");
const route = await import("../../src/app/api/settings/fallback-strategy/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = { cookie: `jroute_session=${token}`, "content-type": "application/json" };

beforeEach(() => {
  getDb().prepare("DELETE FROM settings").run();
});

test("GET without a session is 401", async () => {
  const res = await route.GET(new Request("https://x/api/settings/fallback-strategy"));
  assert.equal(res.status, 401);
});

test("GET returns the default strategy", async () => {
  const res = await route.GET(
    new Request("https://x/api/settings/fallback-strategy", { headers: authHeaders })
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { strategy: string };
  assert.equal(body.strategy, "priority");
});

test("POST with an invalid strategy is 400", async () => {
  const res = await route.POST(
    new Request("https://x/api/settings/fallback-strategy", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ strategy: "weighted" }),
    })
  );
  assert.equal(res.status, 400);
});

test("POST persists the strategy and GET reflects it", async () => {
  const res = await route.POST(
    new Request("https://x/api/settings/fallback-strategy", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ strategy: "round-robin" }),
    })
  );
  assert.equal(res.status, 200);
  assert.equal(getFallbackStrategy(), "round-robin");

  const getRes = await route.GET(
    new Request("https://x/api/settings/fallback-strategy", { headers: authHeaders })
  );
  const body = (await getRes.json()) as { strategy: string };
  assert.equal(body.strategy, "round-robin");
});

test("POST without a session is 401", async () => {
  const res = await route.POST(
    new Request("https://x/api/settings/fallback-strategy", {
      method: "POST",
      body: JSON.stringify({ strategy: "priority" }),
    })
  );
  assert.equal(res.status, 401);
});
