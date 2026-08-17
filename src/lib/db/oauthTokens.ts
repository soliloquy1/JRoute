// src/lib/db/oauthTokens.ts
import { getDb } from "./bootstrap.ts";
import { encrypt, decrypt, looksEncrypted } from "./encryption.ts";

export interface OAuthTokenRow {
  provider: string;
  connectionId: number;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  /**
   * True when a stored ciphertext (`enc:v1:` prefix) could not be decrypted — a
   * rotated/lost STORAGE_ENCRYPTION_KEY or corrupted value. Without this, a decrypt
   * failure collapses to the same `accessToken: null` as "never connected", so
   * callers skipped straight to firing a request with an empty bearer and got a
   * confusing blind 401 instead of surfacing the real cause (mirrors
   * `connections.ts`'s `credentialDecryptFailed`; same class as #6148).
   */
  credentialDecryptFailed: boolean;
}

interface OAuthTokenDbRow {
  provider: string;
  connection_id: number;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
}

/** Write-side shape — `credentialDecryptFailed` is a read-only derived flag, never
 * something a caller sets when persisting a token. */
export type OAuthTokenWrite = Omit<OAuthTokenRow, "credentialDecryptFailed">;

/**
 * Persist an OAuth token pair for a (provider, connection) tuple. All token values are
 * encrypted at rest via the existing `enc:v1:` helper before being written. Upserts on
 * the (provider, connection_id) primary key.
 */
export function upsertOAuthToken(row: OAuthTokenWrite): void {
  getDb()
    .prepare(
      `INSERT INTO oauth_tokens (provider, connection_id, access_token, refresh_token, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider, connection_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at`
    )
    .run(
      row.provider,
      row.connectionId,
      row.accessToken ? encrypt(row.accessToken) : null,
      row.refreshToken ? encrypt(row.refreshToken) : null,
      row.expiresAt ?? null
    );
}

/** Read a stored OAuth token row, decrypting the token values. */
export function getOAuthToken(provider: string, connectionId: number): OAuthTokenRow | null {
  const row = getDb()
    .prepare(
      "SELECT provider, connection_id, access_token, refresh_token, expires_at FROM oauth_tokens WHERE provider = ? AND connection_id = ?"
    )
    .get(provider, connectionId) as OAuthTokenDbRow | undefined;
  if (!row) return null;
  const accessToken = row.access_token ? decrypt(row.access_token) ?? null : null;
  const refreshToken = row.refresh_token ? decrypt(row.refresh_token) ?? null : null;
  const credentialDecryptFailed =
    (looksEncrypted(row.access_token) && accessToken === null) ||
    (looksEncrypted(row.refresh_token) && refreshToken === null);
  if (credentialDecryptFailed) {
    console.warn(
      `[oauthTokens] provider=${row.provider} connection_id=${row.connection_id} has an ` +
        `encrypted token that could not be decrypted. STORAGE_ENCRYPTION_KEY may have ` +
        `changed or the stored value is corrupted.`
    );
  }
  return {
    provider: row.provider,
    connectionId: row.connection_id,
    accessToken,
    refreshToken,
    expiresAt: row.expires_at,
    credentialDecryptFailed,
  };
}

/** Delete a stored OAuth token (e.g. on disconnect). */
export function deleteOAuthToken(provider: string, connectionId: number): void {
  getDb()
    .prepare("DELETE FROM oauth_tokens WHERE provider = ? AND connection_id = ?")
    .run(provider, connectionId);
}

/**
 * Clock-skew tolerance: a token is still treated as valid up to 5 minutes past its
 * stated `expiresAt`. Guards against our clock running slightly ahead of the OAuth
 * issuer's — without this, a technically-still-good token gets discarded early,
 * forcing a needless blind-401-then-refresh round trip (see refresh.ts's 401 retry
 * path, which handles the case where the token really has expired upstream).
 */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** True when a token exists and has not (accounting for clock skew) expired, and
 * was not left null by a decrypt failure. */
export function isTokenValid(row: OAuthTokenRow | null, now: number = Date.now()): boolean {
  if (!row || !row.accessToken || row.credentialDecryptFailed) return false;
  if (row.expiresAt === null) return true;
  return row.expiresAt + CLOCK_SKEW_MS > now;
}
