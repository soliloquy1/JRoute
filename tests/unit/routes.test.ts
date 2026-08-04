// tests/unit/routes.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const chat = await import("../../src/app/api/v1/chat/completions/route.ts");
const models = await import("../../src/app/api/v1/models/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
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

test("GET /v1/models lists enabled providers' ids", async () => {
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
  const res = await models.GET(new Request("https://x/v1/models"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { object: string; data: Array<{ id: string }> };
  assert.equal(body.object, "list");
  assert.ok(body.data.some((m) => m.id === "openai"));
});
