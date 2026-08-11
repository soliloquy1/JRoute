// tests/unit/db-providers.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider, getProvider, listProviders, deleteProvider } =
  await import("../../src/lib/db/providers.ts");
const { createConnection, listConnections } = await import("../../src/lib/db/connections.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM connections").run();
  getDb().prepare("DELETE FROM providers").run();
});

test("upsertProvider inserts, then updates on conflict", () => {
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://a",
    wireFormat: "openai",
    enabled: true,
  });
  upsertProvider({
    id: "openai",
    name: "OpenAI Renamed",
    kind: "apikey",
    baseUrl: "https://b",
    wireFormat: "openai",
    enabled: false,
  });
  const p = getProvider("openai");
  assert.equal(p?.name, "OpenAI Renamed");
  assert.equal(p?.baseUrl, "https://b");
  assert.equal(p?.enabled, false);
  assert.equal(listProviders().length, 1, "upsert must not create a second row");
});

test("listProviders returns all rows ordered by id", () => {
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://a",
    wireFormat: "openai",
    enabled: true,
  });
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://b",
    wireFormat: "anthropic",
    enabled: true,
  });
  assert.deepEqual(
    listProviders().map((p) => p.id),
    ["anthropic", "openai"]
  );
});

test("getProvider returns null for an unknown id", () => {
  assert.equal(getProvider("nonexistent"), null);
});

test("deleteProvider removes the row", () => {
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://a",
    wireFormat: "openai",
    enabled: true,
  });
  deleteProvider("openai");
  assert.equal(getProvider("openai"), null);
});

test("deleteProvider cascades to that provider's connections", () => {
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://a",
    wireFormat: "openai",
    enabled: true,
  });
  createConnection("openai", "primary", "sk-x");
  deleteProvider("openai");
  assert.equal(listConnections("openai").length, 0);
});

test("deleteProvider on a nonexistent id is a no-op, not an error", () => {
  assert.doesNotThrow(() => deleteProvider("nonexistent"));
});
