// jroute/handleChat.ts
import { z } from "zod";
import { jsonError } from "./errors.ts";
import { listConnections, markCooldown, clearCooldown } from "../src/lib/db/connections.ts";
import { logUsage } from "../src/lib/db/usageLogs.ts";
import { eligibleConnections } from "./selectConnection.ts";
import { execute, cooldownMsFor } from "./executor.ts";
import { keepaliveStream, sseHeaders } from "./sse.ts";
import { resolveModel } from "./resolveModel.ts";
import { getConverter } from "./convert/registry.ts";
import { getResponseConverter, getStreamConverter } from "./convert/responseRegistry.ts";
import { mapAnthropicErrorMessage } from "./convert/anthropic/errorMapping.ts";
import { resolveSystemBlocks } from "../src/lib/prompts/assemble.ts";
import { runLorebooksForRequest } from "../src/lib/lorebooks/runner.ts";
import { getPreset } from "../src/lib/db/presets.ts";
import { getRichPreset } from "../src/lib/db/richPresets.ts";
import { assembleRichPreset } from "../src/lib/prompts/richAssemble.ts";
import { runTriggerMode } from "../src/lib/mcp/trigger.ts";
import { getLogitBiasPreset } from "../src/lib/db/logitBiasPresets.ts";
import { computeLogitBias } from "../src/lib/prompts/logitBias.ts";
import { debugLog, debugLogError, redactHeaders } from "../src/lib/debugLog/logger.ts";
import type { ApiKeyRecord } from "../src/lib/db/types.ts";
import type { TaggedBlock } from "./convert/types.ts";

function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function extractRawSystemPrompt(messages: Array<{ role: string; content?: unknown }>): string {
  const systemMessage = messages.find((m) => m.role === "system");
  return systemMessage && typeof systemMessage.content === "string" ? systemMessage.content : "";
}

function extractLastUserMessage(messages: Array<{ role: string; content?: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user" && typeof messages[i].content === "string") {
      return messages[i].content as string;
    }
  }
  return "";
}

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
  /**
   * Tagged blocks from the prompt stage. When omitted, defaults to
   * `resolveSystemBlocks(key.presetId)` (Plan 4) — real `system-block` content from the
   * key's preset. `depth-injection` blocks have no producer yet; that is Plan 5
   * (lorebooks) and Plan 6's trigger-mode tool results. Still overridable here so tests
   * can inject blocks directly without touching the DB.
   */
  blocks?: TaggedBlock[];
}

const DEFAULTS: Pick<HandleChatDeps, "fetchImpl"> = { fetchImpl: fetch };

interface UpstreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export async function handleChat(
  req: Request,
  key: ApiKeyRecord,
  deps: Partial<HandleChatDeps> = {}
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? DEFAULTS.fetchImpl;
  const startedAt = Date.now();
  const requestId = newRequestId();

  debugLog("request.received", {
    requestId,
    method: req.method,
    url: req.url,
    headers: redactHeaders(Object.fromEntries(req.headers.entries())),
    apiKeyId: key.id,
    toolMode: key.toolMode,
  });

  const rawBody = await req.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    debugLog("request.invalid_body", { requestId, rawBody, issues: parsed.error.issues });
    return jsonError(400, "Invalid request body");
  }
  const body = parsed.data as Record<string, unknown>;
  debugLog("request.parsed", { requestId, body });

  const blocks =
    deps.blocks ??
    (await (async () => {
      const messages = parsed.data.messages as Array<{ role: string; content: unknown }>;
      const rawSystemPrompt = extractRawSystemPrompt(messages);
      const triggerBlocks =
        key.toolMode === "trigger"
          ? await runTriggerMode({ lastUserMessage: extractLastUserMessage(messages) })
          : [];

      if (key.richPresetId !== null) {
        const richPreset = getRichPreset(key.richPresetId);
        if (richPreset) {
          const { blocks: richBlocks, samplerParams, consumedSystemPrompt } = assembleRichPreset({
            preset: richPreset,
            messages,
            rawSystemPrompt,
          });
          // Preset sampler params are authoritative over whatever the client sent
          // (design spec §7.1) — mutating `body` here, ahead of the
          // `converter.convertRequest({ ..., body, blocks })` call further below, is what
          // makes the override take effect; that call site itself needs no change.
          Object.assign(body, samplerParams);
          if (consumedSystemPrompt) {
            // richAssemble placed the client's system message into the blocks at the
            // preset's charDescription position. Leaving it in body.messages too would
            // let every converter hoist it a second time — the upstream would receive
            // (and bill for) the character description twice.
            const msgs = body.messages as Array<{ role: string }>;
            const systemIndex = msgs.findIndex((m) => m.role === "system");
            if (systemIndex !== -1) msgs.splice(systemIndex, 1);
          }
          return [...richBlocks, ...triggerBlocks];
        }
        // The key references a preset that no longer exists (deleted after assignment).
        // Falling through to the simple-preset path with no assembly is correct, but it
        // must be visible — a silent no-prompt request is hell to debug from the client side.
        debugLog("preset.stale_reference", { requestId, richPresetId: key.richPresetId });
      }

      const systemBlocks = resolveSystemBlocks(key.presetId);
      const preset = key.presetId !== null ? getPreset(key.presetId) : null;
      const lorebookBlocks =
        preset && preset.lorebookIds.length > 0
          ? runLorebooksForRequest({ lorebookIds: preset.lorebookIds, messages, rawSystemPrompt })
          : [];
      return [...systemBlocks, ...lorebookBlocks, ...triggerBlocks];
    })());
  debugLog("blocks.assembled", { requestId, blocks });

  const requestedModel = String(body.model ?? "");

  // The model field is now meaningful. A model that cannot be served is a 404 — the
  // client asked for something that does not exist — which is deliberately distinct from
  // the two 503s below, which are operator misconfigurations.
  const resolved = resolveModel(requestedModel);
  if (!resolved) {
    debugLog("model.unknown", { requestId, requestedModel });
    return jsonError(404, `Unknown model: ${requestedModel}`);
  }
  const provider = resolved.provider;
  const providerId = provider.id;
  // The client may send a prefixed id (`or/gpt-5.6-sol`); the upstream must receive
  // the native id (`gpt-5.6-sol`). `requestedModel` is preserved for logging only.
  const upstreamModel = resolved.nativeModel;
  debugLog("model.resolved", {
    requestId,
    requestedModel,
    upstreamModel,
    providerId,
    wireFormat: provider.wireFormat,
    maxTokens: resolved.maxTokens,
  });

  if (key.logitBiasPresetId !== null) {
    if (provider.wireFormat === "openai") {
      const biasPreset = getLogitBiasPreset(key.logitBiasPresetId);
      if (biasPreset) {
        body.logit_bias = computeLogitBias(biasPreset.entries);
        debugLog("logitBias.applied", {
          requestId,
          presetId: biasPreset.id,
          tokenCount: Object.keys(body.logit_bias as Record<string, number>).length,
        });
      }
    } else {
      debugLog("logitBias.skipped", {
        requestId,
        presetId: key.logitBiasPresetId,
        wireFormat: provider.wireFormat,
      });
    }
  }

  const converter = getConverter(provider.wireFormat);
  if (!converter) {
    debugLog("converter.missing", { requestId, wireFormat: provider.wireFormat });
    return jsonError(503, `No converter for wire format: ${provider.wireFormat}`);
  }

  const candidates = eligibleConnections(listConnections(providerId), Date.now());
  debugLog("connections.eligible", {
    requestId,
    providerId,
    candidateCount: candidates.length,
    candidateIds: candidates.map((c) => c.id),
  });
  if (candidates.length === 0) {
    return jsonError(503, "No available connection");
  }

  // Converted once, outside the failover loop: every connection for a provider speaks the
  // same wire format, so re-converting per attempt would be wasted work. This also fixes
  // the provider for the whole request — the loop never re-resolves, which is what makes
  // cross-format fallback structurally impossible.
  const upstreamBody = converter.convertRequest({
    model: upstreamModel,
    maxTokens: resolved.maxTokens,
    body,
    blocks,
  });
  debugLog("request.converted", { requestId, wireFormat: provider.wireFormat, upstreamBody });

  // A real upstream attempt and a skipped-before-dialling connection are tracked
  // SEPARATELY. Sharing one `lastMessage` let a decrypt-failed connection sitting
  // *behind* a genuinely failing one rewrite the failure story: the status stayed the
  // real 503 while the message became "credential could not be decrypted", so the
  // response and the `usage_logs` row Plan 7's dashboard reads both recorded the wrong
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
      debugLog("connection.skipped_decrypt_failed", { requestId, connectionId: connection.id });
      continue;
    }

    debugLog("upstream.attempt", {
      requestId,
      attempt,
      connectionId: connection.id,
      connectionLabel: connection.label,
      providerId,
    });

    const result = await execute(
      {
        provider,
        connection,
        body: upstreamBody,
        signal: req.signal,
        model: upstreamModel,
        // The stream flag comes from the CLIENT request body, NOT from `upstreamBody`: the
        // Gemini converter strips `stream` from the converted body (streaming is a URL concern
        // there), so `upstreamBody.stream` is always undefined and the streaming URL would
        // never be selected. `body` here is the parsed pre-conversion client request.
        stream: body.stream === true,
      },
      fetchImpl
    );

    debugLog("upstream.result", {
      requestId,
      attempt,
      connectionId: connection.id,
      ok: result.ok,
      status: result.status,
      errorMessage: result.errorMessage,
      retryable: result.retryable,
      isStream: result.stream !== null,
    });

    // Operator addition A: honor the client-hangup contract.
    // Executor signals an abort as status === 0 AND errorMessage === null.
    // A genuine transport failure is status === 0 with a non-null errorMessage and
    // retryable: true. For an abort we must NOT write a usage row claiming an upstream
    // error (it would corrupt dashboard error stats), must NOT cool down the connection
    // (the upstream may be perfectly healthy), and must NOT fail over.
    if (result.status === 0 && result.errorMessage === null) {
      debugLog("request.client_aborted", { requestId, attempt, connectionId: connection.id });
      return new Response(null, { status: 499 });
    }

    if (result.ok) {
      clearCooldown(connection.id);

      if (result.stream) {
        const streamConverter = getStreamConverter(provider.wireFormat);
        if (!streamConverter) {
          // OpenAI path: unchanged from Plan 1 — already OpenAI-shaped, log immediately
          // with null tokens. Accurate streaming usage for OpenAI is out of this plan's
          // scope (see Global Constraints — Deliberate scope boundary).
          logUsage({
            apiKeyId: key.id,
            providerId,
            connectionId: connection.id,
            model: upstreamModel,
            promptTokens: null,
            outputTokens: null,
            latencyMs: Date.now() - startedAt,
            toolRounds: 0,
            error: null,
          });
          debugLog("response.success", {
            requestId,
            connectionId: connection.id,
            stream: true,
            wireFormat: provider.wireFormat,
          });
          return new Response(keepaliveStream(result.stream), {
            status: 200,
            headers: sseHeaders(),
          });
        }

        // Anthropic path: usage is deferred to stream completion (design spec §9) — the
        // row is written exactly once, when the stream actually ends, whether that is a
        // natural finish, an upstream failure mid-stream, or the client hanging up after
        // real tokens were already spent (the post-dial hangup rule).
        const wrapped = streamConverter.wrap(result.stream, requestedModel, (completion) => {
          const error =
            completion.reason === "completed"
              ? null
              : completion.reason === "client-hangup"
                ? "client disconnected mid-stream"
                : "upstream connection closed unexpectedly";
          debugLog("response.stream_completed", {
            requestId,
            connectionId: connection.id,
            reason: completion.reason,
            promptTokens: completion.promptTokens,
            outputTokens: completion.outputTokens,
          });
          logUsage({
            apiKeyId: key.id,
            providerId,
            connectionId: connection.id,
            model: upstreamModel,
            promptTokens: completion.promptTokens,
            outputTokens: completion.outputTokens,
            latencyMs: Date.now() - startedAt,
            toolRounds: 0,
            error,
          });
        });
        debugLog("response.success", {
          requestId,
          connectionId: connection.id,
          stream: true,
          wireFormat: provider.wireFormat,
        });
        return new Response(keepaliveStream(wrapped), { status: 200, headers: sseHeaders() });
      }

      const responseConverter = getResponseConverter(provider.wireFormat);
      const outJson = responseConverter
        ? responseConverter.convertResponse(result.json, requestedModel)
        : result.json;
      const usage = (outJson as { usage?: UpstreamUsage } | null)?.usage;
      debugLog("response.success", {
        requestId,
        connectionId: connection.id,
        stream: false,
        wireFormat: provider.wireFormat,
        outJson,
      });
      logUsage({
        apiKeyId: key.id,
        providerId,
        connectionId: connection.id,
        model: upstreamModel,
        promptTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        latencyMs: Date.now() - startedAt,
        toolRounds: 0,
        error: null,
      });
      return new Response(JSON.stringify(outJson), {
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
    markCooldown(
      connection.id,
      Date.now() + cooldownMsFor(result.status, attempt, result.retryAfterMs),
      lastMessage
    );
  }

  // A real attempt's outcome always wins. The credential reason is the fallback only
  // when every candidate was skipped before a request was ever sent.
  const failureStatus = lastStatus ?? 502;
  const rawFailureMessage =
    lastMessage ??
    (skippedDecryptFailed
      ? "Connection credential could not be decrypted"
      : "All connections failed");
  // Anthropic-specific message refinement (e.g. billing_error vs. a generic 403) — a no-op
  // for any message that isn't Anthropic's JSON error shape (§10's default: pass through).
  const failureMessage =
    provider.wireFormat === "anthropic"
      ? mapAnthropicErrorMessage(rawFailureMessage)
      : rawFailureMessage;

  debugLog("response.failure", {
    requestId,
    failureStatus,
    failureMessage,
    lastConnectionId,
    skippedDecryptFailed,
  });
  logUsage({
    apiKeyId: key.id,
    providerId,
    connectionId: lastConnectionId,
    model: upstreamModel,
    promptTokens: null,
    outputTokens: null,
    latencyMs: Date.now() - startedAt,
    toolRounds: 0,
    error: failureMessage,
  });
  return jsonError(failureStatus, failureMessage);
}
