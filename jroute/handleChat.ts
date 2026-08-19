// jroute/handleChat.ts
import { z } from "zod";
import { jsonError } from "./errors.ts";
import { logUsage } from "../src/lib/db/usageLogs.ts";
import { recordUsage } from "../src/lib/db/quotaWindows.ts";
import { getOAuthToken, isTokenValid } from "../src/lib/db/oauthTokens.ts";
import { oauthTokenKey } from "../src/lib/oauth/tokenKey.ts";
import { dispatchWithFailover } from "./dispatchAttempt.ts";
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
          const {
            blocks: richBlocks,
            samplerParams,
            consumedSystemPrompt,
          } = assembleRichPreset({
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
  // Phase 2: for OAuth providers, resolve the bearer from the persisted `oauth_tokens`
  // (encrypted) rather than `connection.apiKey`. Injected into the executor so its
  // `execute(params, fetchImpl)` signature stays testable. Returns null when no valid
  // token is stored, falling back to the connection's apiKey (or a 401 upstream).
  const tokenResolver = (connectionId: number): string | null => {
    if (provider.kind !== "oauth") return null;
    const t = getOAuthToken(oauthTokenKey(provider), connectionId);
    return isTokenValid(t) ? (t.accessToken as string) : null;
  };
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
        // The operator-assigned preset is authoritative over whatever the client sent
        // (design spec §3/§5: the bias map is an operator-side key setting, computed fresh
        // per request from the preset's entries). Assigning — not merging — is deliberate:
        // a client-supplied `logit_bias` is overwritten wholesale, so a JanitorAI user
        // cannot un-ban a word the operator banned by sending their own map.
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

  // Candidate resolution, decrypt-failure skipping, the OAuth 401 refresh-then-retry, per-dial
  // quota recording, cooldown marking and failure-message resolution all live in
  // `dispatchWithFailover` now — same logic, one call site deeper, so native tool-calling
  // mode's per-round dispatch (src/lib/mcp/loop.ts) reuses it instead of reimplementing it.
  const dispatch = await dispatchWithFailover({
    provider,
    providerId,
    upstreamModel,
    upstreamBody,
    // The stream flag comes from the CLIENT request body, NOT from `upstreamBody`: the
    // Gemini converter strips `stream` from the converted body (streaming is a URL concern
    // there), so `upstreamBody.stream` is always undefined and the streaming URL would
    // never be selected. `body` here is the parsed pre-conversion client request.
    clientWantsStream: body.stream === true,
    signal: req.signal,
    tokenResolver,
    requestId,
    fetchImpl,
  });

  // `=== false`, not `!dispatch.ok`: this repo compiles with `strict: false`, and with
  // `strictNullChecks` off TypeScript does not narrow a discriminated union by the
  // truthiness of a boolean-literal discriminant (verified by running tsc both ways) —
  // explicit equality does narrow, in both directions.
  if (dispatch.ok === false) {
    // Operator addition A: honor the client-hangup contract. No usage row (it would corrupt
    // dashboard error stats) and no surfaced error message; the no-cooldown/no-failover half
    // of that contract is enforced inside dispatchWithFailover.
    if (dispatch.clientAborted) {
      return new Response(null, { status: 499 });
    }

    // No connection was eligible to dial. Answered bare — no `response.failure` line and no
    // `usage_logs` row — exactly as this path behaved before the dispatch extraction: a
    // request that never reached an upstream is an operator misconfiguration, not an
    // upstream error to attribute to a connection.
    if (dispatch.noCandidates) {
      return jsonError(dispatch.status, dispatch.message);
    }

    // Anthropic-specific message refinement (e.g. billing_error vs. a generic 403) — a no-op
    // for any message that isn't Anthropic's JSON error shape (§10's default: pass through).
    const failureMessage =
      provider.wireFormat === "anthropic"
        ? mapAnthropicErrorMessage(dispatch.message)
        : dispatch.message;

    debugLog("response.failure", {
      requestId,
      failureStatus: dispatch.status,
      failureMessage,
      lastConnectionId: dispatch.connectionId,
      skippedDecryptFailed: dispatch.skippedDecryptFailed,
    });
    logUsage({
      apiKeyId: key.id,
      providerId,
      connectionId: dispatch.connectionId,
      model: upstreamModel,
      promptTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - startedAt,
      toolRounds: 0,
      error: failureMessage,
    });
    return jsonError(dispatch.status, failureMessage);
  }

  const { connectionId, windowMs, result } = dispatch;

  if (result.stream) {
    const streamConverter = getStreamConverter(provider.wireFormat);
    if (!streamConverter) {
      // OpenAI path: unchanged from Plan 1 — already OpenAI-shaped, log immediately
      // with null tokens. Accurate streaming usage for OpenAI is out of this plan's
      // scope (see Global Constraints — Deliberate scope boundary).
      logUsage({
        apiKeyId: key.id,
        providerId,
        connectionId,
        model: upstreamModel,
        promptTokens: null,
        outputTokens: null,
        latencyMs: Date.now() - startedAt,
        toolRounds: 0,
        error: null,
      });
      debugLog("response.success", {
        requestId,
        connectionId,
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
        connectionId,
        reason: completion.reason,
        promptTokens: completion.promptTokens,
        outputTokens: completion.outputTokens,
      });
      // Phase 3/4: fold the realized token usage into the rolling quota window.
      try {
        recordUsage(
          connectionId,
          0,
          (completion.promptTokens ?? 0) + (completion.outputTokens ?? 0),
          Date.now(),
          windowMs
        );
      } catch (err) {
        debugLogError("quota.record_failed", { connectionId, error: String(err) });
      }
      logUsage({
        apiKeyId: key.id,
        providerId,
        connectionId,
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
      connectionId,
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
  // Phase 3/4: fold the token usage into the rolling quota window now that we know it.
  try {
    recordUsage(
      connectionId,
      0,
      (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
      Date.now(),
      windowMs
    );
  } catch (err) {
    debugLogError("quota.record_failed", { connectionId, error: String(err) });
  }
  debugLog("response.success", {
    requestId,
    connectionId,
    stream: false,
    wireFormat: provider.wireFormat,
    outJson,
  });
  logUsage({
    apiKeyId: key.id,
    providerId,
    connectionId,
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
