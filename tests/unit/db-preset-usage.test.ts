// tests/unit/db-preset-usage.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "jroute-preset-usage-"));
  process.env.DATA_DIR = tmpDir;
});

after(async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  resetDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

const minimalRaw = {
  temperature: 1,
  prompts: [{ identifier: "main", name: "Main", role: "system", content: "hi" }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
};

test("key with richPresetId produces an entry with its label", async () => {
  const { issueApiKey, setApiKeyRichPreset } = await import("../../src/lib/auth/apiKeys.ts");
  const { createRichPreset } = await import("../../src/lib/db/richPresets.ts");
  const { richPresetKeyLabels } = await import("../../src/lib/dashboard/presetUsage.ts");
  const rid = createRichPreset("Izumi", minimalRaw);
  const { id } = issueApiKey("alpha");
  setApiKeyRichPreset(id, rid);
  const out = richPresetKeyLabels(await import("../../src/lib/auth/apiKeys.ts").then((m) => m.listApiKeys()));
  assert.ok(out[rid]);
  assert.deepEqual(out[rid], ["alpha"]);
});

test("key with only simple presetId yields no entry for the rich preset id", async () => {
  const { issueApiKey, setApiKeyPreset } = await import("../../src/lib/auth/apiKeys.ts");
  const { createRichPreset } = await import("../../src/lib/db/richPresets.ts");
  const { richPresetKeyLabels } = await import("../../src/lib/dashboard/presetUsage.ts");
  const rid = createRichPreset("Unused", minimalRaw);
  const { id } = issueApiKey("beta");
  setApiKeyPreset(id, 1);
  const out = richPresetKeyLabels(await import("../../src/lib/auth/apiKeys.ts").then((m) => m.listApiKeys()));
  assert.equal(out[rid], undefined);
});

test("key with neither preset yields no entry", async () => {
  const { issueApiKey } = await import("../../src/lib/auth/apiKeys.ts");
  const { createRichPreset } = await import("../../src/lib/db/richPresets.ts");
  const { richPresetKeyLabels } = await import("../../src/lib/dashboard/presetUsage.ts");
  const rid = createRichPreset("Lonely", minimalRaw);
  issueApiKey("gamma");
  const out = richPresetKeyLabels(await import("../../src/lib/auth/apiKeys.ts").then((m) => m.listApiKeys()));
  assert.equal(out[rid], undefined);
});

test("two keys on the same rich preset group both labels under that id", async () => {
  const { issueApiKey, setApiKeyRichPreset } = await import("../../src/lib/auth/apiKeys.ts");
  const { createRichPreset } = await import("../../src/lib/db/richPresets.ts");
  const { richPresetKeyLabels } = await import("../../src/lib/dashboard/presetUsage.ts");
  const rid = createRichPreset("Shared", minimalRaw);
  const a = issueApiKey("k1");
  const b = issueApiKey("k2");
  setApiKeyRichPreset(a.id, rid);
  setApiKeyRichPreset(b.id, rid);
  const out = richPresetKeyLabels(await import("../../src/lib/auth/apiKeys.ts").then((m) => m.listApiKeys()));
  assert.ok(out[rid]);
  assert.equal(out[rid].length, 2);
  assert.ok(out[rid].includes("k1"));
  assert.ok(out[rid].includes("k2"));
});
