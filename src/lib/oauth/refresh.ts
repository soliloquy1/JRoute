// src/lib/oauth/refresh.ts
import type { Provider } from "../db/types.ts";
import { getOAuthToken, upsertOAuthToken, type OAuthTokenRow } from "../db/oauthTokens.ts";

export interface RefreshResult {
  ok: boolean;
  accessToken?: string;
  error?: string;
}

/**
 * Best-effort token-endpoint registry for the expressible OAuth providers. These are the
 * canonical OpenID/OAuth token endpoints; operators may override per-connection via
 * `providerSpecificData.tokenUrl`. Unverified endpoints are intentionally absent — the
 * function errors clearly rather than firing a guessed URL.
 */
const TOKEN_ENDPOINTS: Record<string, string> = {
  claude: "https://api.anthropic.com/v1/oauth/token",
  "xai-oauth": "https://api.x.ai/oauth2/token",
  openference: "https://api.openference.com/oauth/token",
  kilocode: "https://api.kilocode.ai/oauth/token",
  cline: "https://api.coline.ai/oauth/token",
  clinepass: "https://api.coline.ai/oauth/token",
};

function tokenUrlFor(provider: Provider): string | null {
  const overrides = provider.providerSpecificData
    ? (() => {
        try {
          return (JSON.parse(provider.providerSpecificData) as { tokenUrl?: string }).tokenUrl;
        } catch {
          return undefined;
        }
      })()
    : undefined;
  if (overrides) return overrides;
  return (provider.oauthProvider && TOKEN_ENDPOINTS[provider.oauthProvider]) || null;
}

/**
 * Refresh an OAuth connection's access token using its refresh token, then persist the
 * new (encrypted) pair back to `oauth_tokens`. No `open-sse`/combo engine involved — this
 * is the JRoute-native 401-recovery path (plan Phase 2 step 14).
 *
 * Returns the new access token on success so callers can immediately retry without a
 * second `oauth_tokens` read. `fetchImpl` is injectable for tests.
 */
export async function refreshOAuthToken(
  provider: Provider,
  connectionId: number,
  fetchImpl: typeof fetch = fetch
): Promise<RefreshResult> {
  const tokenUrl = tokenUrlFor(provider);
  if (!tokenUrl) {
    return { ok: false, error: `No token endpoint configured for provider ${provider.id}` };
  }

  const existing: OAuthTokenRow | null = getOAuthToken(provider.oauthProvider ?? provider.id, connectionId);
  if (!existing?.refreshToken) {
    return { ok: false, error: "No refresh token available for connection" };
  }

  try {
    const res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: existing.refreshToken,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Token refresh returned ${res.status}` };
    }
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) {
      return { ok: false, error: "Token refresh response missing access_token" };
    }
    const expiresAt = json.expires_in ? Date.now() + json.expires_in * 1000 : existing.expiresAt;
    upsertOAuthToken({
      provider: provider.oauthProvider ?? provider.id,
      connectionId,
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? existing.refreshToken,
      expiresAt,
    });
    return { ok: true, accessToken: json.access_token };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
