// tests/unit/db-connections.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;
// src/lib/db/encryption.ts:62 reads STORAGE_ENCRYPTION_KEY. Any other name leaves
// isEncryptionEnabled() false and encrypt() passes plaintext straight through.
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider, getProvider } = await import("../../src/lib/db/providers.ts");
const {
  createConnection,
  listConnections,
  markCooldown,
  clearCooldown,
  updateConnection,
  deleteConnection,
  getConnectionByProviderAndLabel,
  countProvidersWithConnections,
} = await import("../../src/lib/db/connections.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
});

test("round-trips a provider", () => {
  const p = getProvider("openai");
  assert.equal(p?.wireFormat, "openai");
  assert.equal(p?.enabled, true);
});

test("stores api_key encrypted but returns it decrypted", () => {
  createConnection("openai", "primary", "sk-secret-value");
  const raw = getDb().prepare("SELECT api_key FROM connections WHERE label = 'primary'").get() as {
    api_key: string;
  };
  assert.notEqual(raw.api_key, "sk-secret-value", "must not be stored in plaintext");
  assert.equal(listConnections("openai")[0].apiKey, "sk-secret-value");
});

test("orders connections by priority ascending", () => {
  const a = createConnection("openai", "a", "k1");
  const b = createConnection("openai", "b", "k2");
  getDb().prepare("UPDATE connections SET priority = 10 WHERE id = ?").run(b);
  getDb().prepare("UPDATE connections SET priority = 20 WHERE id = ?").run(a);
  assert.deepEqual(
    listConnections("openai").map((c) => c.label),
    ["b", "a"]
  );
});

test("flags an undecryptable api_key instead of reporting it as absent", () => {
  const id = createConnection("openai", "a", "k1");
  // Well-formed `enc:v1:<iv>:<ciphertext>:<authTag>` — looksEncrypted() accepts it
  // (encryption.ts:111 only checks the prefix) but the auth tag cannot validate
  // under the current key. This is what a rotated/lost key looks like on disk.
  const undecryptable = `enc:v1:${"a".repeat(32)}:${"b".repeat(16)}:${"c".repeat(32)}`;
  getDb().prepare("UPDATE connections SET api_key = ? WHERE id = ?").run(undecryptable, id);

  const conn = listConnections("openai")[0];
  assert.equal(conn.apiKey, null);
  assert.equal(conn.credentialDecryptFailed, true, "must flag a ciphertext that failed to decrypt");
});

test("a genuinely absent api_key is not flagged as a decrypt failure", () => {
  const id = createConnection("openai", "a", "k1");
  getDb().prepare("UPDATE connections SET api_key = NULL WHERE id = ?").run(id);

  const conn = listConnections("openai")[0];
  assert.equal(conn.apiKey, null);
  assert.equal(conn.credentialDecryptFailed, false, "absent key is not a decrypt failure");
});

test("a healthy connection is not flagged as a decrypt failure", () => {
  createConnection("openai", "a", "k1");
  assert.equal(listConnections("openai")[0].credentialDecryptFailed, false);
});

test("markCooldown and clearCooldown move cooldownUntil", () => {
  const id = createConnection("openai", "a", "k1");
  markCooldown(id, 1893456000000, "429 rate limited");
  assert.equal(listConnections("openai")[0].cooldownUntil, 1893456000000);
  clearCooldown(id);
  assert.equal(listConnections("openai")[0].cooldownUntil, null);
  assert.equal(listConnections("openai")[0].lastError, null);
});

test("new connections default to enabled", () => {
  createConnection("openai", "a", "k1");
  assert.equal(listConnections("openai")[0].enabled, true);
});

test("updateConnection can disable a connection without deleting it", () => {
  const id = createConnection("openai", "a", "k1");
  updateConnection(id, { enabled: false });
  const conn = listConnections("openai")[0];
  assert.equal(conn.enabled, false);
  assert.equal(conn.apiKey, "k1", "disabling must not touch the credential");
});

test("updateConnection re-encrypts a new apiKey", () => {
  const id = createConnection("openai", "a", "k1");
  updateConnection(id, { apiKey: "k2" });
  assert.equal(listConnections("openai")[0].apiKey, "k2");
  const raw = getDb().prepare("SELECT api_key FROM connections WHERE id = ?").get(id) as {
    api_key: string;
  };
  assert.notEqual(raw.api_key, "k2", "must still be stored encrypted");
});

test("updateConnection updates only the given fields", () => {
  const id = createConnection("openai", "a", "k1");
  updateConnection(id, { priority: 5 });
  const conn = listConnections("openai")[0];
  assert.equal(conn.priority, 5);
  assert.equal(conn.label, "a", "unpatched fields must survive");
  assert.equal(conn.apiKey, "k1");
});

test("deleteConnection removes the row", () => {
  const id = createConnection("openai", "a", "k1");
  deleteConnection(id);
  assert.equal(listConnections("openai").length, 0);
});

test("getConnectionByProviderAndLabel finds an existing connection", () => {
  createConnection("openai", "primary", "k1");
  const found = getConnectionByProviderAndLabel("openai", "primary");
  assert.equal(found?.label, "primary");
});

test("getConnectionByProviderAndLabel returns null when no match", () => {
  assert.equal(getConnectionByProviderAndLabel("openai", "nope"), null);
});

test("countProvidersWithConnections is 0 when providers exist but none have a connection", () => {
  assert.equal(countProvidersWithConnections(), 0);
});

test("countProvidersWithConnections counts distinct providers, not connections", () => {
  createConnection("openai", "a", "k1");
  createConnection("openai", "b", "k2");
  assert.equal(countProvidersWithConnections(), 1, "two connections on one provider still count as 1");

  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com/v1",
    wireFormat: "anthropic",
    enabled: true,
  });
  createConnection("anthropic", "c", "k3");
  assert.equal(countProvidersWithConnections(), 2);
});
