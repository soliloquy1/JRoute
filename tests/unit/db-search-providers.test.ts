// tests/unit/db-search-providers.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-search-providers-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const {
  createSearchProvider,
  getSearchProvider,
  listSearchProviders,
  updateSearchProvider,
  deleteSearchProvider,
} = await import("../../src/lib/db/searchProviders.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM search_providers").run();
});

test("stores api_key encrypted but returns it decrypted", () => {
  const id = createSearchProvider("brave", "My Brave Key", "brave-secret-value");
  const raw = getDb().prepare("SELECT api_key FROM search_providers WHERE id = ?").get(id) as {
    api_key: string;
  };
  assert.notEqual(raw.api_key, "brave-secret-value", "must not be stored in plaintext");
  assert.equal(getSearchProvider(id)?.apiKey, "brave-secret-value");
});

test("google_cse config_json round-trips", () => {
  const id = createSearchProvider(
    "google_cse",
    "My CSE",
    "cse-secret",
    JSON.stringify({ cx: "abc123" })
  );
  const p = getSearchProvider(id);
  assert.deepEqual(JSON.parse(p!.configJson!), { cx: "abc123" });
});

test("listSearchProviders returns all rows, decrypted", () => {
  createSearchProvider("brave", "A", "key-a");
  createSearchProvider("serpapi", "B", "key-b");
  const list = listSearchProviders();
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((p) => p.apiKey).sort(), ["key-a", "key-b"]);
});

test("updateSearchProvider patches label and re-encrypts a new api key", () => {
  const id = createSearchProvider("brave", "Old Label", "old-key");
  updateSearchProvider(id, { label: "New Label", apiKey: "new-key" });
  const p = getSearchProvider(id);
  assert.equal(p!.label, "New Label");
  assert.equal(p!.apiKey, "new-key");
});

test("deleteSearchProvider removes the row", () => {
  const id = createSearchProvider("brave", "Gone", "key");
  deleteSearchProvider(id);
  assert.equal(getSearchProvider(id), null);
});
