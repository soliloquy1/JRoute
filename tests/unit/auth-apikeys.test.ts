// tests/unit/auth-apikeys.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { issueApiKey, verifyApiKey, revokeApiKey, setApiKeyPreset } =
  await import("../../src/lib/auth/apiKeys.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("issued key verifies and carries its config", () => {
  const { id, secret } = issueApiKey("janitor", "trigger");
  assert.match(secret, /^jr-[0-9a-f]{64}$/);
  const rec = verifyApiKey(secret);
  assert.equal(rec?.id, id);
  assert.equal(rec?.toolMode, "trigger");
  assert.equal(rec?.rateLimitPerMin, 60);
});

test("secret is never stored in plaintext", () => {
  const { id, secret } = issueApiKey("a");
  // Scope to the row just issued: an unqualified `.get()` returns the first row
  // in the table, which is a different key issued by an earlier test.
  const row = getDb().prepare("SELECT key_hash FROM api_keys WHERE id = ?").get(id) as {
    key_hash: string;
  };
  assert.equal(row.key_hash, createHash("sha256").update(secret).digest("hex"));
  assert.notEqual(row.key_hash, secret);
});

test("rejects unknown, malformed, and empty keys", () => {
  assert.equal(verifyApiKey("jr-" + "f".repeat(64)), null);
  assert.equal(verifyApiKey("not-a-key"), null);
  assert.equal(verifyApiKey(""), null);
});

test("revoked key stops verifying", () => {
  const { id, secret } = issueApiKey("b");
  revokeApiKey(id);
  assert.equal(verifyApiKey(secret), null);
});

test("setApiKeyPreset associates a key with a preset, readable via verifyApiKey", () => {
  const { secret } = issueApiKey("janitor");
  const before = verifyApiKey(secret)!;
  assert.equal(before.presetId, null);

  setApiKeyPreset(before.id, 42);
  const after = verifyApiKey(secret)!;
  assert.equal(after.presetId, 42);
});

test("setApiKeyPreset can clear a preset back to null", () => {
  const { secret } = issueApiKey("janitor");
  const key = verifyApiKey(secret)!;
  setApiKeyPreset(key.id, 42);
  setApiKeyPreset(key.id, null);
  assert.equal(verifyApiKey(secret)!.presetId, null);
});
