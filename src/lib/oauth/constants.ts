// src/lib/oauth/constants.ts
/**
 * OAuth endpoint/client config for the 6 expressible providers (Phase 0 enumeration:
 * claude, xai-oauth, kimi-coding, kilocode, cline, clinepass). Trimmed 1:1 from
 * OmniRoute's `src/lib/oauth/constants/oauth.ts` — real token URLs, real client ids
 * (via resolvePublicCred, never literals — Hard Rule #11).
 */
import { resolvePublicCred } from "./publicCreds.ts";

export const OAUTH_TIMEOUT_MS = 300_000;

export const CLAUDE_CONFIG = {
  clientId: resolvePublicCred("claude_id", "CLAUDE_OAUTH_CLIENT_ID"),
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://api.anthropic.com/v1/oauth/token",
  redirectUri:
    process.env.CLAUDE_CODE_REDIRECT_URI || "https://platform.claude.com/oauth/code/callback",
  scopes: [
    "org:create_api_key",
    "user:profile",
    "user:inference",
    "user:sessions:claude_code",
    "user:mcp_servers",
  ],
  codeChallengeMethod: "S256",
};

export const XAI_OAUTH_CONFIG = {
  clientId: resolvePublicCred("grok_id", "GROK_OAUTH_CLIENT_ID"),
  authorizeUrl: "https://auth.x.ai/oauth2/authorize",
  tokenUrl: "https://auth.x.ai/oauth2/token",
  scope: "openid profile email offline_access grok-cli:access api:access",
  codeChallengeMethod: "S256",
  loopbackPort: 56121,
  callbackPath: "/callback",
  callbackHost: "127.0.0.1",
};

export const KIMI_CODING_CONFIG = {
  clientId: resolvePublicCred("kimi_id", "KIMI_CODING_OAUTH_CLIENT_ID"),
  deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
  tokenUrl: "https://auth.kimi.com/api/oauth/token",
};

export const KILOCODE_CONFIG = {
  apiBaseUrl: "https://api.kilo.ai",
  initiateUrl: "https://api.kilo.ai/api/device-auth/codes",
  pollUrlBase: "https://api.kilo.ai/api/device-auth/codes",
};

export const CLINE_CONFIG = {
  authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
  tokenExchangeUrl: "https://api.cline.bot/api/v1/auth/token",
  refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
};
