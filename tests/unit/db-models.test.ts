// tests/unit/db-models.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-models-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider, getProviderByPrefix, prefixOwner } = await import(
  "../../src/lib/db/providers.ts"
);
const {
  createModel,
  listModels,
  getModel,
  modelExists,
  updateModel,
  deleteModel,
  importModels,
  resolveClientModel,
  seedDefaultModels,
} = await import("../../src/lib/db/models.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM providers").run();
});

const seedProvider = (id: string, modelPrefix = "") =>
  upsertProvider({
    id,
    name: id,
    kind: "apikey",
    baseUrl: `https://${id}.example`,
    wireFormat: "openai",
    enabled: true,
    modelPrefix,
  });

test("createModel + getModel + modelExists", () => {
  seedProvider("openai");
  const m = createModel("openai", "gpt-4o", 16384);
  assert.equal(m.modelId, "gpt-4o");
  assert.equal(m.maxTokens, 16384);
  assert.equal(m.enabled, true);
  assert.ok(getModel("openai", "gpt-4o"));
  assert.equal(modelExists("openai", "gpt-4o"), true);
  assert.equal(modelExists("openai", "nope"), false);
});

test("updateModel changes maxTokens and enabled", () => {
  seedProvider("openai");
  createModel("openai", "gpt-4o", 16384);
  updateModel("openai", "gpt-4o", { maxTokens: 8192, enabled: false });
  const m = getModel("openai", "gpt-4o");
  assert.equal(m?.maxTokens, 8192);
  assert.equal(m?.enabled, false);
});

test("deleteModel removes the row", () => {
  seedProvider("openai");
  createModel("openai", "gpt-4o");
  deleteModel("openai", "gpt-4o");
  assert.equal(modelExists("openai", "gpt-4o"), false);
});

test("listModels filters by provider and computes clientId with prefix", () => {
  seedProvider("openai");
  seedProvider("openrouter", "or");
  createModel("openai", "gpt-4o");
  createModel("openrouter", "gpt-5.6-sol");
  const all = listModels();
  // openai also carries its 2 auto-seeded default models
  assert.equal(all.length, 3);
  const orModel = listModels("openrouter")[0];
  assert.equal(orModel.clientId, "or/gpt-5.6-sol");
  const oaModel = listModels("openai")[0];
  assert.equal(oaModel.clientId, "gpt-4o");
});

test("importModels is idempotent and ignores duplicates", () => {
  seedProvider("openai");
  const first = importModels("openai", [
    { id: "gpt-4.1" },
    { id: "gpt-4.1-mini" },
    { id: "gpt-4.1" },
  ]);
  assert.equal(first, 2);
  const second = importModels("openai", [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }]);
  assert.equal(second, 0);
  // 2 imported + 2 default models auto-seeded for the openai provider
  assert.equal(listModels("openai").length, 4);
});

test("resolveClientModel routes a prefixed request only to its provider", () => {
  seedProvider("openrouter", "or");
  createModel("openrouter", "gpt-5.6-sol", 8192);
  const resolved = resolveClientModel("or/gpt-5.6-sol");
  assert.equal(resolved?.providerId, "openrouter");
  assert.equal(resolved?.nativeModel, "gpt-5.6-sol");
  // same native id under a different provider must not resolve bare
  assert.equal(resolveClientModel("gpt-5.6-sol"), null);
});

test("resolveClientModel falls back to legacy empty-prefix providers", () => {
  seedProvider("openai");
  createModel("openai", "gpt-4o", 16384);
  const resolved = resolveClientModel("gpt-4o");
  assert.equal(resolved?.providerId, "openai");
  assert.equal(resolved?.nativeModel, "gpt-4o");
});

test("resolveClientModel returns null for unknown / disabled / missing provider", () => {
  seedProvider("openai");
  createModel("openai", "gpt-4o");
  assert.equal(resolveClientModel("or/gpt-4o"), null);
  assert.equal(resolveClientModel("gpt-unknown"), null);
  updateModel("openai", "gpt-4o", { enabled: false });
  assert.equal(resolveClientModel("gpt-4o"), null);
});

test("getProviderByPrefix finds the provider and prefixOwner detects collisions", () => {
  seedProvider("openrouter", "or");
  assert.equal(getProviderByPrefix("or")?.id, "openrouter");
  assert.equal(getProviderByPrefix("zz"), null);
  assert.equal(prefixOwner("or"), "openrouter");
  assert.equal(prefixOwner("or", "openrouter"), null);
});

test("upsertProvider rejects a duplicate non-empty prefix", () => {
  seedProvider("openrouter", "or");
  assert.throws(() =>
    upsertProvider({
      id: "openrouter2",
      name: "openrouter2",
      kind: "apikey",
      baseUrl: "https://or2.example",
      wireFormat: "openai",
      enabled: true,
      modelPrefix: "or",
    })
  );
});

test("seedDefaultModels seeds legacy models only for existing providers", () => {
  seedProvider("openai");
  seedProvider("anthropic");
  seedDefaultModels();
  assert.equal(modelExists("openai", "gpt-4o"), true);
  assert.equal(modelExists("openai", "gpt-4o-mini"), true);
  assert.equal(modelExists("anthropic", "claude-sonnet-4-6"), true);
  // google provider not created, so its default is skipped (no FK)
  assert.equal(modelExists("google", "gemini-2.0-flash"), false);
  // idempotent
  seedDefaultModels();
  assert.equal(listModels("openai").length, 2);
});
