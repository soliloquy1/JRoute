// tests/unit/resolve-model.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createModel, updateModel } = await import("../../src/lib/db/models.ts");
const { lookupModel } = await import("../../jroute/convert/models.ts");
const { resolveModel } = await import("../../jroute/resolveModel.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM providers").run();
});

const seedProvider = (
  id: string,
  wireFormat: "openai" | "anthropic" | "gemini",
  enabled: boolean,
  modelPrefix = ""
) =>
  upsertProvider({
    id,
    name: id,
    kind: "apikey",
    baseUrl: `https://${id}.example`,
    wireFormat,
    enabled,
    modelPrefix,
  });
const seedModel = (providerId: string, modelId: string, maxTokens = 4096) =>
  createModel(providerId, modelId, maxTokens);

test("lookupModel resolves a legacy (empty-prefix) model to its provider", () => {
  seedProvider("anthropic", "anthropic", true);
  seedModel("anthropic", "claude-sonnet-4-6");
  const entry = lookupModel("claude-sonnet-4-6");
  assert.equal(entry?.providerId, "anthropic");
});

test("lookupModel returns null for an unknown model", () => {
  assert.equal(lookupModel("definitely-not-a-model"), null);
});

test("lookupModel is null for a prefixed model requested bare", () => {
  seedProvider("openrouter", "openai", true, "or");
  seedModel("openrouter", "gpt-5.6-sol");
  assert.equal(lookupModel("gpt-5.6-sol"), null);
});

test("resolveModel routes a prefixed model to its provider only", () => {
  seedProvider("openrouter", "openai", true, "or");
  seedModel("openrouter", "gpt-5.6-sol", 8192);
  const resolved = resolveModel("or/gpt-5.6-sol");
  assert.equal(resolved?.provider.id, "openrouter");
  assert.equal(resolved?.nativeModel, "gpt-5.6-sol");
  assert.equal(resolved?.model, "or/gpt-5.6-sol");
  assert.equal(resolved?.maxTokens, 8192);
});

test("resolveModel returns null for an unknown model", () => {
  seedProvider("anthropic", "anthropic", true);
  assert.equal(resolveModel("definitely-not-a-model"), null);
});

test("resolveModel returns null when the mapped provider is absent", () => {
  assert.equal(resolveModel("claude-sonnet-4-6"), null);
});

test("resolveModel returns null when the mapped provider is disabled", () => {
  seedProvider("anthropic", "anthropic", false);
  seedModel("anthropic", "claude-sonnet-4-6");
  assert.equal(resolveModel("claude-sonnet-4-6"), null);
});

test("resolveModel returns null when the model is disabled", () => {
  seedProvider("anthropic", "anthropic", true);
  seedModel("anthropic", "claude-sonnet-4-6");
  updateModel("anthropic", "claude-sonnet-4-6", { enabled: false });
  assert.equal(resolveModel("claude-sonnet-4-6"), null);
});

test("resolveModel returns null for a prefix with no matching provider", () => {
  assert.equal(resolveModel("xx/whatever"), null);
});

test("lookupModel guards against prototype-pollution keys", () => {
  assert.equal(lookupModel("constructor"), null);
  assert.equal(lookupModel("__proto__"), null);
});
