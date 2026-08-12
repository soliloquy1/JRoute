// tests/unit/preview.test.ts
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
const { createPreset, setPresetLorebooks } = await import("../../src/lib/db/presets.ts");
const { createLorebook } = await import("../../src/lib/db/lorebooks.ts");
const { getLorebookVar } = await import("../../src/lib/db/lorebookVars.ts");
const { scopeKeyFor } = await import("../../src/lib/lorebooks/scopeKey.ts");
const { warmUpSandbox } = await import("../../src/lib/lorebooks/sandbox.ts");
const { buildPreview, PREVIEW_SCOPE_MARKER } = await import("../../src/lib/dashboard/preview.ts");
const preview = await import("../../src/app/api/preview/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

await warmUpSandbox();

upsertProvider({
  id: "openai",
  name: "OpenAI",
  kind: "apikey",
  baseUrl: "https://api.openai.com/v1",
  wireFormat: "openai",
  enabled: true,
});

test("buildPreview returns null for an unknown preset", () => {
  assert.equal(buildPreview(999999, "openai"), null);
});

test("buildPreview runs a real lorebook and returns the converted payload", () => {
  const lorebookId = createLorebook(
    "counter",
    `function activate(ctx) {
       const n = Number(ctx.vars.get("count") ?? "0") + 1;
       ctx.vars.set("count", String(n));
       return { text: "count is " + n, depth: 2 };
     }`
  );
  const presetId = createPreset("preview-test-preset");
  setPresetLorebooks(presetId, [lorebookId]);

  const first = buildPreview(presetId, "openai");
  assert.ok(first);
  assert.equal(JSON.stringify(first!.upstreamBody).includes("count is 1"), true);

  const second = buildPreview(presetId, "openai");
  assert.equal(JSON.stringify(second!.upstreamBody).includes("count is 2"), true);
});

test("preview var writes land in one stable scope, isolated from real character scopes", () => {
  const lorebookId = createLorebook(
    "isolation-check",
    `function activate(ctx) {
       ctx.vars.set("touched", "yes");
       return null;
     }`
  );
  const presetId = createPreset("isolation-preset");
  setPresetLorebooks(presetId, [lorebookId]);

  buildPreview(presetId, "openai");

  const previewScope = scopeKeyFor("character", PREVIEW_SCOPE_MARKER);
  assert.equal(getLorebookVar(lorebookId, previewScope, "touched"), "yes");

  const realCharacterScope = scopeKeyFor("character", "You are Aria, a friendly assistant.");
  assert.equal(getLorebookVar(lorebookId, realCharacterScope, "touched"), null);
});

test("POST /api/preview without a session is 401", async () => {
  const res = await preview.POST(
    new Request("https://x/api/preview", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
});

test("POST /api/preview returns the upstream body for a valid preset+format", async () => {
  const userId = seedInitialUser("admin", "password123");
  const token = createSession(userId);
  const presetId = createPreset("route-test-preset");
  const res = await preview.POST(
    new Request("https://x/api/preview", {
      method: "POST",
      headers: { cookie: `jroute_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ presetId, wireFormat: "openai" }),
    })
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { upstreamBody: Record<string, unknown> };
  assert.ok(body.upstreamBody);
});
