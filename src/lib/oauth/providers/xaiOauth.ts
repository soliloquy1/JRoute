// src/lib/oauth/providers/xaiOauth.ts
import crypto from "node:crypto";
import { XAI_OAUTH_CONFIG } from "../constants.ts";
import type { MappedOAuthTokens } from "../types.ts";

const EXCHANGE_TIMEOUT_MS = 10_000;

interface XaiTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * xAI OAuth (authorization_code + PKCE, automated local loopback callback on a fixed
 * port). The only expressible provider that runs a local server — see server.ts.
 */
export const xaiOauth = {
  config: XAI_OAUTH_CONFIG,
  flowType: "authorization_code_pkce" as const,
  fixedPort: XAI_OAUTH_CONFIG.loopbackPort,
  callbackPath: XAI_OAUTH_CONFIG.callbackPath,
  callbackHost: XAI_OAUTH_CONFIG.callbackHost,
  pkceVerifierBytes: 96,

  buildAuthUrl(
    config: typeof XAI_OAUTH_CONFIG,
    redirectUri: string,
    state: string,
    codeChallenge: string
  ): string {
    const params = {
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scope,
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
      state,
      nonce: crypto.randomBytes(16).toString("hex"),
      plan: "generic",
      referrer: "jroute",
    };
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return `${config.authorizeUrl}?${query}`;
  },

  async exchangeToken(
    config: typeof XAI_OAUTH_CONFIG,
    code: string,
    redirectUri: string,
    codeVerifier: string
  ): Promise<XaiTokenResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EXCHANGE_TIMEOUT_MS);
    try {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
        signal: ctrl.signal,
      });
      if (!response.ok) {
        throw new Error(`xAI token exchange failed: ${await response.text()}`);
      }
      return (await response.json()) as XaiTokenResponse;
    } finally {
      clearTimeout(timer);
    }
  },

  mapTokens(tokens: XaiTokenResponse): MappedOAuthTokens {
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_in ?? null,
    };
  },
};
