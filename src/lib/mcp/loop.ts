// src/lib/mcp/loop.ts
//
// Native-mode round loop (design spec §5). Runs up to `maxRounds` non-streaming upstream turns:
// each turn asks the model (with the MCP tools advertised from `getNativeToolSet`); if the
// model answers with `tool_calls`, every call is executed through its owning MCP server and the
// results are fed back as `role:"tool"` messages; the loop ends when the model returns a plain
// text answer, or the round/timeout budget is exhausted.
//
// `deps` is injected ONLY by tests (tiny budgets, fake dispatch/tool clients). Production call
// sites (Task 10) call `runNativeToolLoop(params)` with no second argument, so the real
// `dispatchWithFailover`, `getNativeToolSet`, `connectMcpClient`, and the spec budgets are used.
import { dispatchWithFailover } from "../../../jroute/dispatchAttempt.ts";
import { sanitizeErrorMessage } from "../../../jroute/errors.ts";
import type { RequestConverter, TaggedBlock } from "../../../jroute/convert/types.ts";
import type { ResponseConverter } from "../../../jroute/convert/responseRegistry.ts";
import { getNativeToolSet } from "./nativeToolSet.ts";
import { connectMcpClient } from "./client.ts";
import { extractTextResult } from "./toolResultText.ts";
import { debugLog, debugLogError } from "../debugLog/logger.ts";
import type { Provider } from "../db/types.ts";

export interface NativeLoopParams {
  provider: Provider;
  providerId: string;
  upstreamModel: string;
  requestedModel: string;
  maxTokens: number;
  clientBody: Record<string, unknown>;
  blocks: TaggedBlock[];
  converter: RequestConverter;
  responseConverter: ResponseConverter | null;
  signal: AbortSignal;
  tokenResolver: (connectionId: number) => string | null;
  requestId: string;
  fetchImpl: typeof fetch;
}

export interface NativeLoopSuccess {
  ok: true;
  finalText: string;
  usage: { promptTokens: number; completionTokens: number };
  roundsUsed: number;
  connectionId: number | null;
}

export interface NativeLoopFailure {
  ok: false;
  status: number;
  message: string;
  connectionId: number | null;
}

export type NativeLoopResult = NativeLoopSuccess | NativeLoopFailure;

export interface NativeLoopDeps {
  dispatch: typeof dispatchWithFailover;
  getToolSet: typeof getNativeToolSet;
  connectClient: typeof connectMcpClient;
  maxRounds: number;
  roundTimeoutMs: number;
  totalTimeoutMs: number;
  toolCallTimeoutMs: number;
  toolResultMaxChars: number;
}

const DEFAULT_DEPS: NativeLoopDeps = {
  dispatch: dispatchWithFailover,
  getToolSet: getNativeToolSet,
  connectClient: connectMcpClient,
  maxRounds: 5,
  roundTimeoutMs: 15_000,
  totalTimeoutMs: 90_000,
  toolCallTimeoutMs: 15_000,
  toolResultMaxChars: 4000,
};

const MAX_ROUNDS_FALLBACK_TEXT =
  "(reached the tool-call limit before finishing — try rephrasing or asking again)";

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function truncateResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [truncated]`;
}

async function executeOneToolCall(
  call: OpenAiToolCall,
  toolSet: Awaited<ReturnType<typeof getNativeToolSet>>,
  deps: NativeLoopDeps,
  requestId: string,
  round: number
): Promise<{ role: "tool"; tool_call_id: string; content: string }> {
  const server = toolSet.resolveServerForTool(call.function.name);
  const startedAt = Date.now();
  if (!server) {
    return { role: "tool", tool_call_id: call.id, content: "tool not found" };
  }
  try {
    const client = await deps.connectClient(server);
    try {
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const result = await Promise.race([
        client.callTool({ name: call.function.name, arguments: args as Record<string, unknown> }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("tool call timeout")), deps.toolCallTimeoutMs)
        ),
      ]);
      const text = truncateResult(extractTextResult(result), deps.toolResultMaxChars);
      debugLog("mcp_native.tool_call", {
        requestId,
        round,
        serverId: server.id,
        toolName: call.function.name,
        latencyMs: Date.now() - startedAt,
        ok: true,
      });
      return { role: "tool", tool_call_id: call.id, content: text };
    } finally {
      await client.close().catch(() => {});
    }
  } catch (err) {
    debugLogError("mcp_native.tool_call_failed", err, {
      requestId,
      round,
      serverId: server.id,
      toolName: call.function.name,
    });
    debugLog("mcp_native.tool_call", {
      requestId,
      round,
      serverId: server.id,
      toolName: call.function.name,
      latencyMs: Date.now() - startedAt,
      ok: false,
    });
    return {
      role: "tool",
      tool_call_id: call.id,
      content: `tool call failed: ${sanitizeErrorMessage(err)}`,
    };
  }
}

export async function runNativeToolLoop(
  params: NativeLoopParams,
  deps: NativeLoopDeps = DEFAULT_DEPS
): Promise<NativeLoopResult> {
  const {
    provider,
    providerId,
    upstreamModel,
    requestedModel,
    maxTokens,
    clientBody,
    blocks,
    converter,
    responseConverter,
    signal,
    tokenResolver,
    requestId,
    fetchImpl,
  } = params;

  const toolSet = await deps.getToolSet();
  const openAiTools = toolSet.tools;

  const workingMessages: unknown[] = Array.isArray(clientBody.messages)
    ? [...(clientBody.messages as unknown[])]
    : [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let lastConnectionId: number | null = null;
  const loopDeadline = Date.now() + deps.totalTimeoutMs;

  for (let round = 0; round < deps.maxRounds; round += 1) {
    if (Date.now() >= loopDeadline) {
      return {
        ok: false,
        status: 504,
        message: "native tool loop exceeded its time budget",
        connectionId: lastConnectionId,
      };
    }

    const roundBody: Record<string, unknown> = { ...clientBody, messages: workingMessages };
    if (openAiTools.length > 0) {
      roundBody.tools = openAiTools;
      roundBody.tool_choice = "auto";
    } else {
      delete roundBody.tools;
      delete roundBody.tool_choice;
    }

    const upstreamBody = converter.convertRequest({
      model: upstreamModel,
      maxTokens,
      body: roundBody,
      blocks,
    });
    const roundSignal = AbortSignal.any([signal, AbortSignal.timeout(deps.roundTimeoutMs)]);

    const dispatchResult = await deps.dispatch({
      provider,
      providerId,
      upstreamModel,
      upstreamBody,
      clientWantsStream: false,
      signal: roundSignal,
      tokenResolver,
      requestId,
      fetchImpl,
    });

    if (dispatchResult.ok === false) {
      return {
        ok: false,
        status: dispatchResult.status,
        message: dispatchResult.message,
        connectionId: dispatchResult.connectionId,
      };
    }
    lastConnectionId = dispatchResult.connectionId;

    const outJson = responseConverter
      ? responseConverter.convertResponse(dispatchResult.result.json, requestedModel)
      : (dispatchResult.result.json as Record<string, unknown>);
    const choice = (outJson.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const message = (choice?.message as Record<string, unknown>) ?? {};
    const usage = outJson.usage as
      { prompt_tokens?: number; completion_tokens?: number } | undefined;
    totalPromptTokens += usage?.prompt_tokens ?? 0;
    totalCompletionTokens += usage?.completion_tokens ?? 0;

    const toolCalls = Array.isArray(message.tool_calls)
      ? (message.tool_calls as OpenAiToolCall[])
      : [];
    debugLog("mcp_native.round", {
      requestId,
      round,
      toolCallCount: toolCalls.length,
      connectionId: lastConnectionId,
    });

    if (toolCalls.length === 0) {
      return {
        ok: true,
        finalText: typeof message.content === "string" ? message.content : "",
        usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
        roundsUsed: round + 1,
        connectionId: lastConnectionId,
      };
    }

    if (round === deps.maxRounds - 1) {
      const partialText = typeof message.content === "string" ? message.content : "";
      return {
        ok: true,
        finalText: partialText.length > 0 ? partialText : MAX_ROUNDS_FALLBACK_TEXT,
        usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
        roundsUsed: round + 1,
        connectionId: lastConnectionId,
      };
    }

    workingMessages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: toolCalls,
    });
    for (const call of toolCalls) {
      const toolResult = await executeOneToolCall(call, toolSet, deps, requestId, round);
      workingMessages.push(toolResult);
    }
  }

  return {
    ok: false,
    status: 500,
    message: "native tool loop exited without resolving",
    connectionId: lastConnectionId,
  };
}
