// src/lib/db/oauthTokens.ts
import { getDb } from "./bootstrap.ts";
import { encrypt, decrypt } from "./encryption.ts";

export interface OAuthTokenRow {
  provider: string;
  connectionId: number;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}

interface OAuthTokenDbRow {
  provider: string;
  connection_id: number;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
}

/**
 * Persist an OAuth token pair for a (provider, connection) tuple. All token values are
 * encrypted at rest via the existing `enc:v1:` helper before being written. Upserts on
 * the (provider, connection_id) primary key.
 */
export function upsertOAuthToken(row: OAuthTokenRow): void {
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
  return {
    provider: row.provider,
    connectionId: row.connection_id,
    accessToken: row.access_token ? decrypt(row.access_token) ?? null : null,
    refreshToken: row.refresh_token ? decrypt(row.refresh_token) ?? null : null,
    expiresAt: row.expires_at,
  };
}

/** Delete a stored OAuth token (e.g. on disconnect). */
export function deleteOAuthToken(provider: string, connectionId: number): void {
  getDb()
    .prepare("DELETE FROM oauth_tokens WHERE provider = ? AND connection_id = ?")
    .run(provider, connectionId);
}

/** True when a token exists and has not yet expired. */
export function isTokenValid(row: OAuthTokenRow | null, now: number = Date.now()): boolean {
  if (!row || !row.accessToken) return false;
  if (row.expiresAt === null) return true;
  return row.expiresAt > now;
}
