// src/lib/dashboard/testConnection.ts
import { getConnectionById, markCooldown, clearCooldown } from "@/lib/db/connections.ts";
import { getProvider } from "@/lib/db/providers.ts";
import { getConverter } from "@jroute/convert/registry.ts";
import { listModelIds, lookupModel } from "@jroute/convert/models.ts";
import { execute, cooldownMsFor } from "@jroute/executor.ts";
import { getOAuthToken, isTokenValid } from "@/lib/db/oauthTokens.ts";
import { oauthTokenKey } from "@/lib/oauth/tokenKey.ts";

export interface TestConnectionResult {
  ok: boolean;
  error: string | null;
}

/**
 * A cheap, real upstream call reusing the SAME converter registry and executor the
 * live proxy path uses (jroute/handleChat.ts) — not a hand-rolled per-format request
 * shape. Picks the first MODEL_MAP entry belonging to the connection's provider.
 */
export async function testConnection(connectionId: number): Promise<TestConnectionResult> {
  const connection = getConnectionById(connectionId);
  if (!connection) return { ok: false, error: "Connection not found" };

  if (connection.credentialDecryptFailed) {
    return {
      ok: false,
      error: "Stored credential could not be decrypted — check STORAGE_ENCRYPTION_KEY",
    };
  }

  const provider = getProvider(connection.providerId);
  if (!provider) return { ok: false, error: "Provider not found" };

  const converter = getConverter(provider.wireFormat);
  if (!converter) {
    return { ok: false, error: `No converter for wire format: ${provider.wireFormat}` };
  }

  const model = listModelIds().find((id) => lookupModel(id)?.providerId === provider.id);
  if (!model) return { ok: false, error: "No models configured for this provider" };
  const maxTokens = lookupModel(model)!.maxTokens;

  const upstreamBody = converter.convertRequest({
    model,
    maxTokens,
    body: { model, messages: [{ role: "user", content: "ping" }] },
    blocks: [],
  });

  // Without this, an oauth-kind connection's test always dials with an empty bearer:
  // execute() only consults oauth_tokens through an injected resolver (never getDb()
  // itself), so omitting it here silently falls back to connection.apiKey — empty for
  // oauth connections — and every OAuth connection test blind-401s regardless of
  // whether the stored token is actually valid.
  const tokenResolver = (connectionId: number): string | null => {
    if (provider.kind !== "oauth") return null;
    const t = getOAuthToken(oauthTokenKey(provider), connectionId);
    return isTokenValid(t) ? (t.accessToken as string) : null;
  };

  const result = await execute({
    provider,
    connection,
    body: upstreamBody,
    signal: AbortSignal.timeout(10000),
    model,
    stream: false,
    tokenResolver,
  });

  if (result.ok) {
    clearCooldown(connectionId);
    return { ok: true, error: null };
  }

  const message = result.errorMessage ?? "Test request failed";
  markCooldown(
    connectionId,
    Date.now() + cooldownMsFor(result.status, 0, result.retryAfterMs),
    message
  );
  return { ok: false, error: message };
}
