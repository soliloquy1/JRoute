// tests/unit/auth-api-keys-logit-bias.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "jroute-apikeys-logit-bias-"));
  process.env.DATA_DIR = tmpDir;
});

after(async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  resetDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("new keys default to no logit bias preset", async () => {
  const { issueApiKey, listApiKeys } = await import("../../src/lib/auth/apiKeys.ts");
  issueApiKey("test-key");
  const [key] = listApiKeys();
  assert.equal(key.logitBiasPresetId, null);
});

test("setApiKeyLogitBiasPreset assigns and clears independently of prompt presets", async () => {
  const { issueApiKey, setApiKeyLogitBiasPreset, setApiKeyPreset, listApiKeys } =
    await import("../../src/lib/auth/apiKeys.ts");
  const { createLogitBiasPreset } = await import("../../src/lib/db/logitBiasPresets.ts");
  const { createPreset } = await import("../../src/lib/db/presets.ts");
  const { id } = issueApiKey("test-key-2");
  const biasId = createLogitBiasPreset("Bias A", []);
  const presetId = createPreset("Preset A");

  setApiKeyPreset(id, presetId);
  setApiKeyLogitBiasPreset(id, biasId);

  const [key] = listApiKeys();
  // Assigning a logit bias preset must NOT clear the independently-set prompt preset —
  // unlike preset_id/rich_preset_id, these are orthogonal fields (spec §3).
  assert.equal(key.presetId, presetId);
  assert.equal(key.logitBiasPresetId, biasId);

  setApiKeyLogitBiasPreset(id, null);
  const [cleared] = listApiKeys();
  assert.equal(cleared.logitBiasPresetId, null);
  assert.equal(cleared.presetId, presetId);
});
