// src/lib/oauth/providers/index.ts
import { claude } from "./claude.ts";
import { xaiOauth } from "./xaiOauth.ts";
import { kimiCoding } from "./kimiCoding.ts";
import { kilocode } from "./kilocode.ts";
import { cline } from "./cline.ts";

/** clinepass reuses the Cline flow 1:1 (same host, same token shape) — see
 * catalog/providers.ts registry note. */
export const OAUTH_PROVIDERS = {
  claude,
  "xai-oauth": xaiOauth,
  "kimi-coding": kimiCoding,
  kilocode,
  cline,
  clinepass: cline,
} as const;

export type OAuthProviderKey = keyof typeof OAUTH_PROVIDERS;

export function isOAuthProviderKey(key: string): key is OAuthProviderKey {
  return key in OAUTH_PROVIDERS;
}

export function getOAuthProvider(key: string): (typeof OAUTH_PROVIDERS)[OAuthProviderKey] {
  if (!isOAuthProviderKey(key)) throw new Error(`Unknown OAuth provider: ${key}`);
  return OAUTH_PROVIDERS[key];
}
