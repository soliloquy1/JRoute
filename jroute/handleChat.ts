// jroute/handleChat.ts
import { z } from "zod";
import { jsonError } from "./errors.ts";
import { getProvider } from "../src/lib/db/providers.ts";
import { listConnections, markCooldown, clearCooldown } from "../src/lib/db/connections.ts";
import { logUsage } from "../src/lib/db/usageLogs.ts";
import { eligibleConnections } from "./selectConnection.ts";
import { execute, cooldownMsFor } from "./executor.ts";
import { keepaliveStream, sseHeaders } from "./sse.ts";
import type { ApiKeyRecord } from "../src/lib/db/types.ts";

export const ChatRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(z.object({ role: z.string(), content: z.unknown() })).min(1),
    stream: z.boolean().optional(),
  })
  .passthrough();

export interface HandleChatDeps {
  fetchImpl: typeof fetch;
  providerId: string;
}

const DEFAULTS: HandleChatDeps = { fetchImpl: fetch, providerId: "openai" };

interface UpstreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export async function handleChat(
  req: Request,
  key: ApiKeyRecord,
  deps: Partial<HandleChatDeps> = {}
): Promise<Response> {
  const { fetchImpl, providerId } = { ...DEFAULTS, ...deps };
  const startedAt = Date.now();

  const parsed = ChatRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "Invalid request body");
  }
  const body = parsed.data as Record<string, unknown>;

  const provider = getProvider(providerId);
  if (!provider || !provider.enabled) {
    return jsonError(503, "No provider configured");
  }

  const candidates = eligibleConnections(listConnections(providerId), Date.now());
  if (candidates.length === 0) {
    return jsonError(503, "No available connection");
  }

  let lastStatus = 502;
  let lastMessage = "All connections failed";

  for (let attempt = 0; attempt < candidates.length; attempt += 1) {
    const connection = candidates[attempt];

    // Operator addition B: skip connections whose credential could not be decrypted.
    // This is a config problem (rotated/lost STORAGE_ENCRYPTION_KEY), not a connection
    // health issue. Do not cool down — just skip and let healthy connections behind it
    // get their turn. If every candidate is in this state, the operator gets the
    // distinct "could not be decrypted" reason rather than a generic upstream failure.
    if (connection.credentialDecryptFailed) {
      lastMessage = "Connection credential could not be decrypted";
      continue;
    }

    const result = await execute({ provider, connection, body, signal: req.signal }, fetchImpl);

    // Operator addition A: honor the client-hangup contract.
    // Executor signals an abort as status === 0 AND errorMessage === null.
    // A genuine transport failure is status === 0 with a non-null errorMessage and
    // retryable: true. For an abort we must NOT write a usage row claiming an upstream
    // error (it would corrupt dashboard error stats), must NOT cool down the connection
    // (the upstream may be perfectly healthy), and must NOT fail over.
    if (result.status === 0 && result.errorMessage === null) {
      return new Response(null, { status: 499 });
    }

    if (result.ok) {
      clearCooldown(connection.id);

      if (result.stream) {
        // Usage is unknown until the stream ends; Plan 2 adds token accounting
        // from the final SSE frame.
        logUsage({
          apiKeyId: key.id,
          providerId,
          connectionId: connection.id,
          model: String(body.model ?? ""),
          promptTokens: null,
          outputTokens: null,
          latencyMs: Date.now() - startedAt,
          toolRounds: 0,
          error: null,
        });
        return new Response(keepaliveStream(result.stream), { status: 200, headers: sseHeaders() });
      }

      const usage = (result.json as { usage?: UpstreamUsage } | null)?.usage;
      logUsage({
        apiKeyId: key.id,
        providerId,
        connectionId: connection.id,
        model: String(body.model ?? ""),
        promptTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        latencyMs: Date.now() - startedAt,
        toolRounds: 0,
        error: null,
      });
      return new Response(JSON.stringify(result.json), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    lastStatus = result.status || 502;
    lastMessage = result.errorMessage ?? "Upstream error";

    if (!result.retryable) break;
    markCooldown(connection.id, Date.now() + cooldownMsFor(result.status, attempt), lastMessage);
  }

  logUsage({
    apiKeyId: key.id,
    providerId,
    connectionId: null,
    model: String(body.model ?? ""),
    promptTokens: null,
    outputTokens: null,
    latencyMs: Date.now() - startedAt,
    toolRounds: 0,
    error: lastMessage,
  });
  return jsonError(lastStatus, lastMessage);
}
