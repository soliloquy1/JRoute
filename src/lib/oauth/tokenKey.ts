// src/lib/oauth/tokenKey.ts
import type { Provider } from "../db/types.ts";

/**
 * Canonical key for `oauth_tokens` rows. The writer (persist.ts, refresh.ts) and the
 * reader (jroute/handleChat.ts's tokenResolver) MUST agree on this, or a refreshed
 * token gets written under a different key than the one the executor looks up —
 * previously computed inline as `provider.oauthProvider ?? provider.id` at
 * handleChat.ts:181 with no shared helper. Route every read/write through here.
 */
export function oauthTokenKey(provider: Pick<Provider, "id" | "oauthProvider">): string {
  return provider.oauthProvider ?? provider.id;
}
