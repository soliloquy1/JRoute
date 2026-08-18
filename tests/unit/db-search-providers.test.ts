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
const { getActiveSearchProviderId, setActiveSearchProviderId } =
  await import("../../src/lib/db/settings.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM search_providers").run();
  getDb().prepare("DELETE FROM settings").run();
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

test("deleting the active provider clears activeSearchProviderId", () => {
  const id = createSearchProvider("brave", "Active", "key");
  setActiveSearchProviderId(id);
  deleteSearchProvider(id);
  assert.equal(getActiveSearchProviderId(), null, "must not keep pointing at a deleted row");
});

test("deleting a non-active provider leaves activeSearchProviderId alone", () => {
  const keep = createSearchProvider("brave", "Keep", "key-a");
  const drop = createSearchProvider("serpapi", "Drop", "key-b");
  setActiveSearchProviderId(keep);
  deleteSearchProvider(drop);
  assert.equal(getActiveSearchProviderId(), keep);
});

test("an api key that cannot be decrypted surfaces as credentialDecryptFailed, not an empty key", () => {
  const id = createSearchProvider("brave", "Rotated", "real-key");
  // Simulate a rotated/lost STORAGE_ENCRYPTION_KEY: the stored value still carries the
  // `enc:v1:` prefix but no longer opens with the current key.
  getDb()
    .prepare("UPDATE search_providers SET api_key = ? WHERE id = ?")
    .run("enc:v1:not-a-real-ciphertext", id);
  const p = getSearchProvider(id);
  assert.equal(p!.apiKey, null, "must not collapse an undecryptable key to an empty string");
  assert.equal(p!.credentialDecryptFailed, true);
});

test("a provider with a decryptable key reports credentialDecryptFailed false", () => {
  const id = createSearchProvider("brave", "Fine", "key");
  assert.equal(getSearchProvider(id)!.credentialDecryptFailed, false);
});
