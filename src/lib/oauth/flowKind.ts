// src/lib/oauth/flowKind.ts
/**
 * Single source of truth for which UI flow each expressible OAuth provider uses.
 * Pure (no Node/DB deps) so both the server route and the client-side connect modal
 * import the same mapping instead of duplicating the provider lists.
 */
export type OAuthUiFlowKind = "authorize_paste" | "loopback" | "device_code";

const AUTHORIZE_PASTE = new Set(["claude", "cline", "clinepass"]);
const LOOPBACK = new Set(["xai-oauth"]);
const DEVICE_CODE = new Set(["kimi-coding", "kilocode"]);

export function oauthUiFlowKind(providerKey: string): OAuthUiFlowKind | null {
  if (AUTHORIZE_PASTE.has(providerKey)) return "authorize_paste";
  if (LOOPBACK.has(providerKey)) return "loopback";
  if (DEVICE_CODE.has(providerKey)) return "device_code";
  return null;
}
