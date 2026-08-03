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
const { createConnection, listConnections, markCooldown, clearCooldown } =
  await import("../../src/lib/db/connections.ts");

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

test("markCooldown and clearCooldown move cooldownUntil", () => {
  const id = createConnection("openai", "a", "k1");
  markCooldown(id, 1893456000000, "429 rate limited");
  assert.equal(listConnections("openai")[0].cooldownUntil, 1893456000000);
  clearCooldown(id);
  assert.equal(listConnections("openai")[0].cooldownUntil, null);
  assert.equal(listConnections("openai")[0].lastError, null);
});
