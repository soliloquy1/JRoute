// src/lib/oauth/refresh.ts
import { CLAUDE_CONFIG, XAI_OAUTH_CONFIG, KIMI_CODING_CONFIG, CLINE_CONFIG } from "./constants.ts";
import { getOAuthToken, upsertOAuthToken } from "../db/oauthTokens.ts";
import { oauthTokenKey } from "./tokenKey.ts";
import type { Provider } from "../db/types.ts";

const REFRESH_TIMEOUT_MS = 10_000;

interface RefreshResult {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
}

/** Standard RFC 6749 §6 refresh_token grant, form-encoded. Real behavior for
 * claude/xai-oauth/kimi-coding (verified against OmniRoute's
 * open-sse/services/tokenRefresh/providers/{claudeOAuth,kimiCoding}.ts and
 * open-sse/executors/xai.ts refreshCredentials). */
async function refreshFormEncoded(
  tokenUrl: string,
  params: Record<string, string>,
  extraHeaders: Record<string, string> = {}
): Promise<RefreshResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REFRESH_TIMEOUT_MS);
  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...extraHeaders,
      },
      body: new URLSearchParams(params),
      signal: ctrl.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.access_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresIn: data.expires_in ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cline's refresh endpoint expects JSON (camelCase) rather than the form-encoded
 * RFC 6749 grant the other 3 providers use — verified against OmniRoute's
 * open-sse/services/tokenRefresh/providers/cline.ts. Kept deliberately different
 * rather than force-fitting it to the form-encoded convention.
 */
async function refreshClineJson(refreshToken: string): Promise<RefreshResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REFRESH_TIMEOUT_MS);
  try {
    const response = await fetch(CLINE_CONFIG.refreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" }),
      signal: ctrl.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data ?? payload;
    if (!data?.accessToken) return null;
    const expiresIn = data.expiresAt
      ? Math.max(1, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000))
      : null;
    return { accessToken: data.accessToken, refreshToken: data.refreshToken ?? refreshToken, expiresIn };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refresh the stored OAuth token for one (provider, connection) and persist the
 * result. Returns the new access token on success; null when the provider has no
 * refresh support (kilocode — device-flow token has no refresh_token, matching
 * OmniRoute's own kilocode.ts), there's no refresh_token stored yet, or the refresh
 * call itself failed (revoked/expired refresh_token, network error).
 */
export async function refreshOAuthToken(
  provider: Provider,
  connectionId: number
): Promise<string | null> {
  const key = oauthTokenKey(provider);
  const current = getOAuthToken(key, connectionId);
  if (!current?.refreshToken) return null;

  let result: RefreshResult | null;
  switch (key) {
    case "claude":
      result = await refreshFormEncoded(
        CLAUDE_CONFIG.tokenUrl,
        { grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: CLAUDE_CONFIG.clientId },
        { "anthropic-beta": "oauth-2025-04-20" }
      );
      break;
    case "xai-oauth":
      result = await refreshFormEncoded(XAI_OAUTH_CONFIG.tokenUrl, {
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: XAI_OAUTH_CONFIG.clientId,
      });
      break;
    case "kimi-coding":
      result = await refreshFormEncoded(KIMI_CODING_CONFIG.tokenUrl, {
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: KIMI_CODING_CONFIG.clientId,
      });
      break;
    case "cline":
    case "clinepass":
      result = await refreshClineJson(current.refreshToken);
      break;
    default:
      return null;
  }

  if (!result) return null;

  upsertOAuthToken({
    provider: key,
    connectionId,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken ?? current.refreshToken,
    expiresAt: result.expiresIn !== null ? Date.now() + result.expiresIn * 1000 : null,
  });
  return result.accessToken;
}
