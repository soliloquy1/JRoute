// src/lib/oauth/providers/cline.ts
import { CLINE_CONFIG } from "../constants.ts";
import type { MappedOAuthTokens } from "../types.ts";

const EXCHANGE_TIMEOUT_MS = 10_000;

interface ClineTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: string | number;
}

/**
 * Cline OAuth (authorization_code, no PKCE, no local callback server). `clinepass`
 * reuses this 1:1 — same api.cline.bot host, same token shape (see registry note in
 * catalog/providers.ts).
 *
 * Cline embeds the tokens as base64-encoded JSON directly in the "code" the callback
 * redirects with; the HTTP token-exchange endpoint is a fallback for shapes that
 * don't decode that way.
 */
export const cline = {
  config: CLINE_CONFIG,
  flowType: "authorization_code" as const,

  buildAuthUrl(config: typeof CLINE_CONFIG, redirectUri: string): string {
    const params = new URLSearchParams({
      client_type: "extension",
      callback_url: redirectUri,
      redirect_uri: redirectUri,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },

  async exchangeToken(
    config: typeof CLINE_CONFIG,
    code: string,
    redirectUri: string
  ): Promise<ClineTokens> {
    try {
      let base64 = code;
      try {
        base64 = decodeURIComponent(base64);
      } catch {
        /* already decoded */
      }
      const padding = 4 - (base64.length % 4);
      if (padding !== 4) base64 += "=".repeat(padding);
      const decoded = Buffer.from(base64, "base64").toString("utf-8");
      const lastBrace = decoded.lastIndexOf("}");
      if (lastBrace === -1) throw new Error("No JSON found in decoded code");
      const parsed = JSON.parse(decoded.slice(0, lastBrace + 1));
      if (!parsed.accessToken) throw new Error("Decoded code missing accessToken");
      return {
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken,
        expires_at: parsed.expiresAt,
      };
    } catch {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), EXCHANGE_TIMEOUT_MS);
      try {
        const response = await fetch(config.tokenExchangeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            client_type: "extension",
            redirect_uri: redirectUri,
          }),
          signal: ctrl.signal,
        });
        if (!response.ok) {
          throw new Error(`Cline token exchange failed: ${await response.text()}`);
        }
        const data = await response.json();
        return {
          access_token: data.data?.accessToken || data.accessToken,
          refresh_token: data.data?.refreshToken || data.refreshToken,
          expires_at: data.data?.expiresAt || data.expiresAt,
        };
      } finally {
        clearTimeout(timer);
      }
    }
  },

  mapTokens(tokens: ClineTokens): MappedOAuthTokens {
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_at
        ? Math.max(1, Math.floor((new Date(tokens.expires_at).getTime() - Date.now()) / 1000))
        : 3600,
    };
  },
};
