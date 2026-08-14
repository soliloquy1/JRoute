// tests/unit/api-keys-logit-bias-assign.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-api-keys-logit-bias-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { issueApiKey, listApiKeys } = await import("../../src/lib/auth/apiKeys.ts");
const { createLogitBiasPreset } = await import("../../src/lib/db/logitBiasPresets.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const DASHBOARD_AUTH_HEADER = {
  cookie: `jroute_session=${token}`,
  "content-type": "application/json",
};

test("PATCH /api/keys/:id assigns a logit bias preset", async () => {
  const { id } = issueApiKey("test-key");
  const biasId = createLogitBiasPreset("Bias A", []);

  const { PATCH } = await import("../../src/app/api/keys/[id]/route.ts");
  const res = await PATCH(
    new Request(`http://localhost/api/keys/${id}`, {
      method: "PATCH",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ logitBiasPresetId: biasId }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);

  const [key] = listApiKeys();
  assert.equal(key.logitBiasPresetId, biasId);
});

test("PATCH /api/keys/:id clears a logit bias preset with null", async () => {
  const { id } = issueApiKey("test-key-2");
  const biasId = createLogitBiasPreset("Bias B", []);
  const { PATCH } = await import("../../src/app/api/keys/[id]/route.ts");
  await PATCH(
    new Request(`http://localhost/api/keys/${id}`, {
      method: "PATCH",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ logitBiasPresetId: biasId }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  await PATCH(
    new Request(`http://localhost/api/keys/${id}`, {
      method: "PATCH",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ logitBiasPresetId: null }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  const keys = listApiKeys();
  const key = keys.find((k) => k.id === id);
  assert.equal(key?.logitBiasPresetId, null);
});
