// src/lib/dashboard/testConnection.ts
import { getConnectionById, markCooldown, clearCooldown } from "@/lib/db/connections.ts";
import { getProvider } from "@/lib/db/providers.ts";
import { getConverter } from "@jroute/convert/registry.ts";
import { listModelIds, lookupModel } from "@jroute/convert/models.ts";
import { execute, cooldownMsFor } from "@jroute/executor.ts";

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

  const result = await execute({
    provider,
    connection,
    body: upstreamBody,
    signal: AbortSignal.timeout(10000),
    model,
    stream: false,
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
