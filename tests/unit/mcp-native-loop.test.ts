// tests/unit/mcp-native-loop.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runNativeToolLoop, type NativeLoopDeps } from "../../src/lib/mcp/loop.ts";
import type { DispatchOutcome } from "../../jroute/dispatchAttempt.ts";
import type { Provider } from "../../src/lib/db/types.ts";

const provider: Provider = {
  id: "openai",
  name: "OpenAI",
  kind: "apikey",
  baseUrl: "https://api.openai.com/v1",
  wireFormat: "openai",
  enabled: true,
  modelPrefix: "",
};

const passthroughConverter = { convertRequest: (p: { body: Record<string, unknown> }) => p.body };

function baseParams(overrides: Partial<Parameters<typeof runNativeToolLoop>[0]> = {}) {
  return {
    provider,
    providerId: "openai",
    upstreamModel: "gpt-5.6-sol",
    requestedModel: "gpt-5.6-sol",
    maxTokens: 8000,
    clientBody: { messages: [{ role: "user", content: "hi" }] },
    blocks: [],
    converter: passthroughConverter,
    responseConverter: null,
    signal: new AbortController().signal,
    tokenResolver: () => null,
    requestId: "test-req",
    fetchImpl: fetch,
    ...overrides,
  };
}

function chatCompletionJson(
  message: Record<string, unknown>,
  usage = { prompt_tokens: 10, completion_tokens: 5 }
) {
  return { choices: [{ message }], usage };
}

test("no tool calls in round 1 — resolves immediately with the text, one round used", async () => {
  const deps: NativeLoopDeps = {
    dispatch: async () => ({
      ok: true,
      connectionId: 1,
      windowMs: 60000,
      result: {
        ok: true,
        status: 200,
        stream: null,
        json: chatCompletionJson({ role: "assistant", content: "hello" }),
        errorMessage: null,
        retryable: false,
        retryAfterMs: null,
      },
    }),
    getToolSet: async () => ({ tools: [], resolveServerForTool: () => null }),
    connectClient: (async () => {
      throw new Error("should not be called");
    }) as never,
    maxRounds: 5,
    roundTimeoutMs: 15000,
    totalTimeoutMs: 90000,
    toolCallTimeoutMs: 15000,
    toolResultMaxChars: 4000,
  };
  const result = await runNativeToolLoop(baseParams(), deps);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.finalText, "hello");
    assert.equal(result.roundsUsed, 1);
    assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 5 });
  }
});

test("a tool_calls round executes the tool via connectClient and resolves on round 2", async () => {
  let dispatchCallCount = 0;
  const deps: NativeLoopDeps = {
    dispatch: async () => {
      dispatchCallCount += 1;
      if (dispatchCallCount === 1) {
        return {
          ok: true,
          connectionId: 1,
          windowMs: 60000,
          result: {
            ok: true,
            status: 200,
            stream: null,
            errorMessage: null,
            retryable: false,
            retryAfterMs: null,
            json: chatCompletionJson({
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "web_search", arguments: '{"query":"cats"}' },
                },
              ],
            }),
          },
        };
      }
      return {
        ok: true,
        connectionId: 1,
        windowMs: 60000,
        result: {
          ok: true,
          status: 200,
          stream: null,
          errorMessage: null,
          retryable: false,
          retryAfterMs: null,
          json: chatCompletionJson({ role: "assistant", content: "found some cats" }),
        },
      };
    },
    getToolSet: async () => ({
      tools: [
        { type: "function", function: { name: "web_search", description: "d", parameters: {} } },
      ],
      resolveServerForTool: (name) =>
        name === "web_search" ? ({ id: 1, name: "search-server" } as never) : null,
    }),
    connectClient: (async () => ({
      callTool: async () => ({ content: [{ type: "text", text: "cat results here" }] }),
      close: async () => {},
    })) as never,
    maxRounds: 5,
    roundTimeoutMs: 15000,
    totalTimeoutMs: 90000,
    toolCallTimeoutMs: 15000,
    toolResultMaxChars: 4000,
  };
  const result = await runNativeToolLoop(baseParams(), deps);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.finalText, "found some cats");
    assert.equal(result.roundsUsed, 2);
  }
  assert.equal(dispatchCallCount, 2);
});

test("a failed tool call is isolated — injects a failure message, loop continues rather than aborting", async () => {
  let dispatchCallCount = 0;
  const deps: NativeLoopDeps = {
    dispatch: async (p) => {
      dispatchCallCount += 1;
      if (dispatchCallCount === 1) {
        return {
          ok: true,
          connectionId: 1,
          windowMs: 60000,
          result: {
            ok: true,
            status: 200,
            stream: null,
            errorMessage: null,
            retryable: false,
            retryAfterMs: null,
            json: chatCompletionJson({
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "web_search", arguments: "{}" },
                },
              ],
            }),
          },
        };
      }
      // Round 2's upstream body should now contain a role:"tool" message with the failure text.
      const roundMessages = (p.upstreamBody as { messages: Array<Record<string, unknown>> })
        .messages;
      const toolMsg = roundMessages.find((m) => m.role === "tool");
      assert.ok(
        typeof toolMsg?.content === "string" &&
          (toolMsg.content as string).includes("tool call failed")
      );
      return {
        ok: true,
        connectionId: 1,
        windowMs: 60000,
        result: {
          ok: true,
          status: 200,
          stream: null,
          errorMessage: null,
          retryable: false,
          retryAfterMs: null,
          json: chatCompletionJson({ role: "assistant", content: "sorry, search failed" }),
        },
      };
    },
    getToolSet: async () => ({
      tools: [
        { type: "function", function: { name: "web_search", description: "d", parameters: {} } },
      ],
      resolveServerForTool: () => ({ id: 1, name: "search-server" }) as never,
    }),
    connectClient: (async () => ({
      callTool: async () => {
        throw new Error("upstream MCP server unreachable");
      },
      close: async () => {},
    })) as never,
    maxRounds: 5,
    roundTimeoutMs: 15000,
    totalTimeoutMs: 90000,
    toolCallTimeoutMs: 15000,
    toolResultMaxChars: 4000,
  };
  const result = await runNativeToolLoop(baseParams(), deps);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.finalText, "sorry, search failed");
});

test("max rounds exhausted with partial text returns that text, not the fallback", async () => {
  const alwaysToolCalls = async (): Promise<DispatchOutcome> => ({
    ok: true,
    connectionId: 1,
    windowMs: 60000,
    result: {
      ok: true,
      status: 200,
      stream: null,
      errorMessage: null,
      retryable: false,
      retryAfterMs: null,
      json: chatCompletionJson({
        role: "assistant",
        content: "still working on it",
        tool_calls: [
          { id: "call_x", type: "function", function: { name: "web_search", arguments: "{}" } },
        ],
      }),
    },
  });
  const deps: NativeLoopDeps = {
    dispatch: alwaysToolCalls,
    getToolSet: async () => ({
      tools: [
        { type: "function", function: { name: "web_search", description: "d", parameters: {} } },
      ],
      resolveServerForTool: () => ({ id: 1, name: "search-server" }) as never,
    }),
    connectClient: (async () => ({
      callTool: async () => ({ content: [{ type: "text", text: "x" }] }),
      close: async () => {},
    })) as never,
    maxRounds: 2, // small for a fast test — exercises the same "last round still has tool_calls" branch
    roundTimeoutMs: 15000,
    totalTimeoutMs: 90000,
    toolCallTimeoutMs: 15000,
    toolResultMaxChars: 4000,
  };
  const result = await runNativeToolLoop(baseParams(), deps);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.finalText, "still working on it");
    assert.equal(result.roundsUsed, 2);
  }
});

test("max rounds exhausted with NO text returns the fixed fallback string", async () => {
  const alwaysToolCallsNoText = async (): Promise<DispatchOutcome> => ({
    ok: true,
    connectionId: 1,
    windowMs: 60000,
    result: {
      ok: true,
      status: 200,
      stream: null,
      errorMessage: null,
      retryable: false,
      retryAfterMs: null,
      json: chatCompletionJson({
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_x", type: "function", function: { name: "web_search", arguments: "{}" } },
        ],
      }),
    },
  });
  const deps: NativeLoopDeps = {
    dispatch: alwaysToolCallsNoText,
    getToolSet: async () => ({
      tools: [
        { type: "function", function: { name: "web_search", description: "d", parameters: {} } },
      ],
      resolveServerForTool: () => ({ id: 1, name: "search-server" }) as never,
    }),
    connectClient: (async () => ({
      callTool: async () => ({ content: [{ type: "text", text: "x" }] }),
      close: async () => {},
    })) as never,
    maxRounds: 1,
    roundTimeoutMs: 15000,
    totalTimeoutMs: 90000,
    toolCallTimeoutMs: 15000,
    toolResultMaxChars: 4000,
  };
  const result = await runNativeToolLoop(baseParams(), deps);
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.finalText, /reached the tool-call limit/);
});

test("a dispatch failure propagates as the loop's own failure — not isolated like a tool-call failure", async () => {
  const deps: NativeLoopDeps = {
    dispatch: async () => ({
      ok: false,
      clientAborted: false,
      noCandidates: false,
      status: 503,
      message: "All connections failed",
      connectionId: null,
      skippedDecryptFailed: false,
    }),
    getToolSet: async () => ({ tools: [], resolveServerForTool: () => null }),
    connectClient: (async () => {
      throw new Error("should not be called");
    }) as never,
    maxRounds: 5,
    roundTimeoutMs: 15000,
    totalTimeoutMs: 90000,
    toolCallTimeoutMs: 15000,
    toolResultMaxChars: 4000,
  };
  const result = await runNativeToolLoop(baseParams(), deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
});

test("total wall-clock budget exceeded returns a 504 before another round starts", async () => {
  const deps: NativeLoopDeps = {
    dispatch: async () => {
      await new Promise((r) => setTimeout(r, 20));
      return {
        ok: true,
        connectionId: 1,
        windowMs: 60000,
        result: {
          ok: true,
          status: 200,
          stream: null,
          errorMessage: null,
          retryable: false,
          retryAfterMs: null,
          json: chatCompletionJson({
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_x", type: "function", function: { name: "web_search", arguments: "{}" } },
            ],
          }),
        },
      };
    },
    getToolSet: async () => ({
      tools: [
        { type: "function", function: { name: "web_search", description: "d", parameters: {} } },
      ],
      resolveServerForTool: () => ({ id: 1, name: "search-server" }) as never,
    }),
    connectClient: (async () => ({
      callTool: async () => ({ content: [{ type: "text", text: "x" }] }),
      close: async () => {},
    })) as never,
    maxRounds: 100, // high enough that only the total budget stops it
    roundTimeoutMs: 15000,
    totalTimeoutMs: 30, // tiny — the second round's dispatch (20ms) plus overhead exceeds this
    toolCallTimeoutMs: 15000,
    toolResultMaxChars: 4000,
  };
  const result = await runNativeToolLoop(baseParams(), deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 504);
});

test("a tool result over the truncation cap is cut with a marker before being appended", async () => {
  let capturedToolContent = "";
  let dispatchCallCount = 0;
  const deps: NativeLoopDeps = {
    dispatch: async (p) => {
      dispatchCallCount += 1;
      if (dispatchCallCount === 1) {
        return {
          ok: true,
          connectionId: 1,
          windowMs: 60000,
          result: {
            ok: true,
            status: 200,
            stream: null,
            errorMessage: null,
            retryable: false,
            retryAfterMs: null,
            json: chatCompletionJson({
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "web_search", arguments: "{}" },
                },
              ],
            }),
          },
        };
      }
      const roundMessages = (p.upstreamBody as { messages: Array<Record<string, unknown>> })
        .messages;
      capturedToolContent = roundMessages.find((m) => m.role === "tool")?.content as string;
      return {
        ok: true,
        connectionId: 1,
        windowMs: 60000,
        result: {
          ok: true,
          status: 200,
          stream: null,
          errorMessage: null,
          retryable: false,
          retryAfterMs: null,
          json: chatCompletionJson({ role: "assistant", content: "done" }),
        },
      };
    },
    getToolSet: async () => ({
      tools: [
        { type: "function", function: { name: "web_search", description: "d", parameters: {} } },
      ],
      resolveServerForTool: () => ({ id: 1, name: "search-server" }) as never,
    }),
    connectClient: (async () => ({
      callTool: async () => ({ content: [{ type: "text", text: "x".repeat(100) }] }),
      close: async () => {},
    })) as never,
    maxRounds: 5,
    roundTimeoutMs: 15000,
    totalTimeoutMs: 90000,
    toolCallTimeoutMs: 15000,
    toolResultMaxChars: 10, // tiny cap for a fast, deterministic assertion
  };
  await runNativeToolLoop(baseParams(), deps);
  assert.equal(capturedToolContent.length, 10 + "... [truncated]".length);
  assert.ok(capturedToolContent.endsWith("... [truncated]"));
});
