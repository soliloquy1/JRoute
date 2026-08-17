// src/lib/oauth/providers/claude.ts
import { CLAUDE_CONFIG } from "../constants.ts";
import type { MappedOAuthTokens } from "../types.ts";

const EXCHANGE_TIMEOUT_MS = 10_000;

interface ClaudeTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Claude OAuth (authorization_code + PKCE). Fixed non-loopback redirect_uri
 * (platform.claude.com) — no local callback server; the user pastes the resulting
 * "code#state" back after completing the browser flow.
 */
export const claude = {
  config: CLAUDE_CONFIG,
  flowType: "authorization_code_pkce" as const,

  buildAuthUrl(config: typeof CLAUDE_CONFIG, _redirectUri: string, state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      code: "true",
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
      state,
      // Forces re-authentication instead of silently reusing the browser session —
      // avoids Anthropic invalidating a sibling account's refresh_token family on
      // multi-account setups (ported comment from OmniRoute's claude.ts).
      prompt: "login",
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },

  async exchangeToken(
    config: typeof CLAUDE_CONFIG,
    code: string,
    _redirectUri: string,
    codeVerifier: string,
    state: string
  ): Promise<ClaudeTokenResponse> {
    let authCode = code;
    let codeState = "";
    if (authCode.includes("#")) {
      const parts = authCode.split("#");
      authCode = parts[0];
      codeState = parts[1] || "";
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EXCHANGE_TIMEOUT_MS);
    try {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          code: authCode,
          state: codeState || state,
          grant_type: "authorization_code",
          client_id: config.clientId,
          redirect_uri: config.redirectUri,
          code_verifier: codeVerifier,
        }),
        signal: ctrl.signal,
      });
      if (!response.ok) {
        throw new Error(`Claude token exchange failed: ${await response.text()}`);
      }
      return (await response.json()) as ClaudeTokenResponse;
    } finally {
      clearTimeout(timer);
    }
  },

  mapTokens(tokens: ClaudeTokenResponse): MappedOAuthTokens {
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_in ?? null,
    };
  },
};
