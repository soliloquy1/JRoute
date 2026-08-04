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

// `looseObject` (not `object`) at BOTH levels. A plain `z.object` strips unknown keys,
// and the message element is what matters: stripping there silently deletes
// `tool_call_id` from a `role: "tool"` message, `tool_calls` from an assistant message,
// and `name` from a user message. OpenAI 400s a tool message with no `tool_call_id`, so
// a stripped field renders as an error to whoever is chatting, and any multi-turn tool
// conversation the client replays is quietly gutted. `.passthrough()` is the Zod 3 form
// and is `@deprecated` in the installed Zod 4.4.3 (schemas.d.cts:460) in favour of
// `z.looseObject()`; both were verified to preserve the extra keys, so use the
// non-deprecated one.
export const ChatRequestSchema = z.looseObject({
  model: z.string().min(1),
  // `content` is optional: the OpenAI API permits omitting it on assistant tool-call
  // messages ({ role: "assistant", tool_calls: [...] }) — the field is not present in
  // that object at all, and `z.unknown()` (non-optional) would reject it with 400.
  messages: z.array(z.looseObject({ role: z.string(), content: z.unknown().optional() })).min(1),
  stream: z.boolean().optional(),
});

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

  // A real upstream attempt and a skipped-before-dialling connection are tracked
  // SEPARATELY. Sharing one `lastMessage` let a decrypt-failed connection sitting
  // *behind* a genuinely failing one rewrite the failure story: the status stayed the
  // real 503 while the message became "credential could not be decrypted", so the
  // response and the `usage_logs` row Plan 6's dashboard reads both recorded the wrong
  // cause. The credential reason is only surfaced when no real attempt ever produced one.
  let lastStatus: number | null = null;
  let lastMessage: string | null = null;
  let lastConnectionId: number | null = null;
  let skippedDecryptFailed = false;

  for (let attempt = 0; attempt < candidates.length; attempt += 1) {
    const connection = candidates[attempt];

    // Operator addition B: skip connections whose credential could not be decrypted.
    // This is a config problem (rotated/lost STORAGE_ENCRYPTION_KEY), not a connection
    // health issue. Do not cool down — just skip and let healthy connections behind it
    // get their turn. If every candidate is in this state, the operator gets the
    // distinct "could not be decrypted" reason rather than a generic upstream failure.
    if (connection.credentialDecryptFailed) {
      skippedDecryptFailed = true;
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
    // Attribute the failure row to the connection that actually produced it, so the
    // dashboard can answer "which key is 503-ing" instead of just "something failed".
    lastConnectionId = connection.id;

    if (!result.retryable) break;
    markCooldown(connection.id, Date.now() + cooldownMsFor(result.status, attempt), lastMessage);
  }

  // A real attempt's outcome always wins. The credential reason is the fallback only
  // when every candidate was skipped before a request was ever sent.
  const failureStatus = lastStatus ?? 502;
  const failureMessage =
    lastMessage ??
    (skippedDecryptFailed
      ? "Connection credential could not be decrypted"
      : "All connections failed");

  logUsage({
    apiKeyId: key.id,
    providerId,
    connectionId: lastConnectionId,
    model: String(body.model ?? ""),
    promptTokens: null,
    outputTokens: null,
    latencyMs: Date.now() - startedAt,
    toolRounds: 0,
    error: failureMessage,
  });
  return jsonError(failureStatus, failureMessage);
}
