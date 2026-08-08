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
const { lookupModel, listModelIds, MODEL_MAP } = await import("../../jroute/convert/models.ts");
const { resolveModel } = await import("../../jroute/resolveModel.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM providers").run();
});

const seed = (id: string, wireFormat: "openai" | "anthropic", enabled: boolean) =>
  upsertProvider({
    id,
    name: id,
    kind: "apikey",
    baseUrl: `https://${id}.example`,
    wireFormat,
    enabled,
  });

test("lookupModel returns the entry for a known model", () => {
  const entry = lookupModel("claude-sonnet-4-6");
  assert.equal(entry?.providerId, "anthropic");
  assert.ok((entry?.maxTokens ?? 0) > 0, "a known model must carry a positive maxTokens");
});

test("lookupModel returns null for an unknown model", () => {
  assert.equal(lookupModel("definitely-not-a-model"), null);
});

test("every MODEL_MAP entry has a positive maxTokens and a non-empty providerId", () => {
  for (const [id, entry] of Object.entries(MODEL_MAP)) {
    assert.ok(entry.providerId.length > 0, `${id} must name a provider`);
    assert.ok(entry.maxTokens > 0, `${id} must have a positive maxTokens`);
  }
});

test("listModelIds returns the map keys", () => {
  const ids = listModelIds();
  assert.ok(ids.includes("claude-sonnet-4-6"));
  assert.equal(ids.length, Object.keys(MODEL_MAP).length);
});

test("resolveModel joins the map to an enabled provider row", () => {
  seed("anthropic", "anthropic", true);
  const resolved = resolveModel("claude-sonnet-4-6");
  assert.equal(resolved?.provider.id, "anthropic");
  assert.equal(resolved?.provider.wireFormat, "anthropic");
  assert.equal(resolved?.model, "claude-sonnet-4-6");
  assert.equal(resolved?.maxTokens, MODEL_MAP["claude-sonnet-4-6"].maxTokens);
});

test("resolveModel returns null for an unknown model", () => {
  seed("anthropic", "anthropic", true);
  assert.equal(resolveModel("definitely-not-a-model"), null);
});

test("resolveModel returns null when the mapped provider is absent", () => {
  assert.equal(resolveModel("claude-sonnet-4-6"), null);
});

test("resolveModel returns null when the mapped provider is disabled", () => {
  seed("anthropic", "anthropic", false);
  assert.equal(resolveModel("claude-sonnet-4-6"), null);
});

test("lookupModel uses hasOwnProperty to guard against prototype pollution", () => {
  assert.equal(lookupModel("constructor"), null);
  assert.equal(lookupModel("__proto__"), null);
});
