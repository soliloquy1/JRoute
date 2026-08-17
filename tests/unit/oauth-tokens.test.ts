// tests/unit/oauth-tokens.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-oauth-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const {
  upsertOAuthToken,
  getOAuthToken,
  deleteOAuthToken,
  isTokenValid,
} = await import("../../src/lib/db/oauthTokens.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

// oauth_tokens.connection_id is a FK to connections(id) — set up a provider + connections
// so the rows we write reference real connections.
upsertProvider({
  id: "claude",
  name: "Claude Code",
  kind: "oauth",
  baseUrl: "https://api.anthropic.com",
  wireFormat: "anthropic",
  enabled: true,
  oauthProvider: "claude",
});
upsertProvider({
  id: "xai-oauth",
  name: "xAI OAuth",
  kind: "oauth",
  baseUrl: "https://api.x.ai",
  wireFormat: "openai",
  enabled: true,
  oauthProvider: "xai-oauth",
});
createConnection("claude", "c1", "sk-1");
createConnection("xai-oauth", "c2", "sk-2");

test("upsert + get round-trips an encrypted token", () => {
  upsertOAuthToken({
    provider: "claude",
    connectionId: 1,
    accessToken: "access-abc",
    refreshToken: "refresh-def",
    expiresAt: Date.now() + 60_000,
  });
  // Raw row must be encrypted at rest.
  const raw = getDb()
    .prepare("SELECT access_token FROM oauth_tokens WHERE provider = 'claude' AND connection_id = 1")
    .get() as { access_token: string };
  assert.ok(raw.access_token.startsWith("enc:v1:"));

  const row = getOAuthToken("claude", 1);
  assert.equal(row?.accessToken, "access-abc");
  assert.equal(row?.refreshToken, "refresh-def");
  assert.equal(row?.provider, "claude");
});

test("on conflict, upsert overwrites the token pair", () => {
  upsertOAuthToken({ provider: "claude", connectionId: 1, accessToken: "v1", refreshToken: "r1", expiresAt: 1 });
  upsertOAuthToken({ provider: "claude", connectionId: 1, accessToken: "v2", refreshToken: "r2", expiresAt: 2 });
  const row = getOAuthToken("claude", 1);
  assert.equal(row?.accessToken, "v2");
  assert.equal(row?.refreshToken, "r2");
});

test("deleteOAuthToken removes the row", () => {
  upsertOAuthToken({ provider: "xai-oauth", connectionId: 2, accessToken: "a", refreshToken: "r", expiresAt: null });
  assert.ok(getOAuthToken("xai-oauth", 2));
  deleteOAuthToken("xai-oauth", 2);
  assert.equal(getOAuthToken("xai-oauth", 2), null);
});

test("isTokenValid: null token is invalid; non-expired is valid; well-expired is invalid", () => {
  assert.equal(isTokenValid(null), false);
  const now = Date.now();
  assert.equal(
    isTokenValid(
      { provider: "p", connectionId: 1, accessToken: "a", refreshToken: null, expiresAt: null, credentialDecryptFailed: false },
      now
    ),
    true
  );
  assert.equal(
    isTokenValid(
      { provider: "p", connectionId: 1, accessToken: "a", refreshToken: null, expiresAt: now + 60_000, credentialDecryptFailed: false },
      now
    ),
    true
  );
  // Well past the 5-minute clock-skew margin: invalid.
  assert.equal(
    isTokenValid(
      { provider: "p", connectionId: 1, accessToken: "a", refreshToken: null, expiresAt: now - 400_000, credentialDecryptFailed: false },
      now
    ),
    false
  );
  // A decrypt-failed row is never valid, even with a future expiresAt.
  assert.equal(
    isTokenValid(
      { provider: "p", connectionId: 1, accessToken: "a", refreshToken: null, expiresAt: now + 60_000, credentialDecryptFailed: true },
      now
    ),
    false
  );
});

test("isTokenValid: clock-skew margin tolerates a token expired up to 5 minutes ago", () => {
  const now = Date.now();
  // Expired 1 minute ago — within the 5-minute skew margin, still usable.
  assert.equal(
    isTokenValid(
      { provider: "p", connectionId: 1, accessToken: "a", refreshToken: null, expiresAt: now - 60_000, credentialDecryptFailed: false },
      now
    ),
    true
  );
  // Expired ~6.6 minutes ago — outside the margin, invalid.
  assert.equal(
    isTokenValid(
      { provider: "p", connectionId: 1, accessToken: "a", refreshToken: null, expiresAt: now - 400_000, credentialDecryptFailed: false },
      now
    ),
    false
  );
});

test("getOAuthToken: a ciphertext that fails to decrypt is flagged, not silently null (#6148 class)", () => {
  upsertOAuthToken({ provider: "claude", connectionId: 1, accessToken: "will-corrupt", refreshToken: null, expiresAt: null });
  const raw = getDb()
    .prepare("SELECT access_token FROM oauth_tokens WHERE provider = 'claude' AND connection_id = 1")
    .get() as { access_token: string };
  // Corrupt the ciphertext body while keeping the enc:v1: prefix, so looksEncrypted()
  // is still true but decrypt() fails (simulates a rotated STORAGE_ENCRYPTION_KEY).
  const corrupted = raw.access_token.slice(0, -4) + "beef";
  getDb()
    .prepare("UPDATE oauth_tokens SET access_token = ? WHERE provider = 'claude' AND connection_id = 1")
    .run(corrupted);

  const row = getOAuthToken("claude", 1);
  assert.equal(row?.accessToken, null);
  assert.equal(row?.credentialDecryptFailed, true);
  assert.equal(isTokenValid(row), false);
});
