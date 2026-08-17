// src/lib/oauth/persist.ts
import { createConnection } from "../db/connections.ts";
import { upsertOAuthToken } from "../db/oauthTokens.ts";
import { oauthTokenKey } from "./tokenKey.ts";
import type { Provider } from "../db/types.ts";
import type { MappedOAuthTokens } from "./types.ts";

/**
 * Create the `connections` row for a freshly completed OAuth flow and persist the
 * token pair (encrypted) into `oauth_tokens`. The connection's `api_key` column stays
 * empty — oauth-kind connections are always resolved through `oauth_tokens` via the
 * executor's `tokenResolver` seam (jroute/executor.ts).
 */
export function persistOAuthConnection(
  provider: Provider,
  label: string,
  tokens: MappedOAuthTokens
): number {
  const connectionId = createConnection(provider.id, label, "", { priority: 100 });
  const expiresAt = tokens.expiresIn !== null ? Date.now() + tokens.expiresIn * 1000 : null;
  upsertOAuthToken({
    provider: oauthTokenKey(provider),
    connectionId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt,
  });
  return connectionId;
}
