// tests/unit/mcp-native-loop-e2e.test.ts
//
// Proves runNativeToolLoop + getNativeToolSet + the real builtin search MCP server compose
// correctly end-to-end: a real InMemoryTransport round trip (no external process), the right
// tool gets called with the right arguments, its result reaches the loop's next round.
// Does NOT exercise a live network search call — the final internet hop (the Brave API) is
// stubbed by spying on globalThis.fetch so it returns a canned "Real Cats" payload. Every
// other link in the chain (DB row -> nativeToolSet -> connectMcpClient -> builtin MCP server
// -> web_search tool) is REAL, exactly as it would run in production.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-native-loop-e2e-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createMcpServer } = await import("../../src/lib/db/mcpServers.ts");
const { createSearchProvider } = await import("../../src/lib/db/searchProviders.ts");
const { setActiveSearchProviderId } = await import("../../src/lib/db/settings.ts");
const { clearNativeToolSetCacheForTests } = await import("../../src/lib/mcp/nativeToolSet.ts");
const { runNativeToolLoop } = await import("../../src/lib/mcp/loop.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM mcp_servers").run();
  getDb().prepare("DELETE FROM search_providers").run();
  getDb().prepare("DELETE FROM settings").run();
  clearNativeToolSetCacheForTests();
});

const provider = {
  id: "openai",
  name: "OpenAI",
  kind: "apikey" as const,
  baseUrl: "https://api.openai.com/v1",
  wireFormat: "openai" as const,
  enabled: true,
};

const passthroughConverter = { convertRequest: (p: { body: Record<string, unknown> }) => p.body };

test("a real web_search tool call round-trips through the actual builtin MCP server", async (t) => {
  createMcpServer("JRoute Web Search", "builtin", "", {
    enabled: true,
    toolAllowlist: "web_search,web_fetch",
  });
  const providerId = createSearchProvider("brave", "Test Brave", "brave-test-key");
  setActiveSearchProviderId(providerId);

  // Stub ONLY the final internet hop: the builtin web_search tool's Brave API call. The real
  // tool still parses this response, so a "Real Cats" result reaching the loop proves the
  // actual tool executed.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        web: {
          results: [
            { title: "Real Cats", url: "https://example.com/cats", description: "All about cats." },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as never;
  try {
    let round = 0;
    let capturedToolResultContent = "";
    const result = await runNativeToolLoop(
      {
        provider,
        providerId: "openai",
        upstreamModel: "gpt-5.6-sol",
        requestedModel: "gpt-5.6-sol",
        maxTokens: 8000,
        clientBody: { messages: [{ role: "user", content: "search for cats" }] },
        blocks: [],
        converter: passthroughConverter,
        responseConverter: null,
        signal: new AbortController().signal,
        tokenResolver: () => null,
        requestId: "e2e-test",
        fetchImpl: fetch,
      },
      {
        dispatch: async (p) => {
          round += 1;
          if (round === 1) {
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
                json: {
                  choices: [
                    {
                      message: {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            id: "call_1",
                            type: "function",
                            function: { name: "web_search", arguments: '{"query":"cats"}' },
                          },
                        ],
                      },
                    },
                  ],
                  usage: { prompt_tokens: 10, completion_tokens: 5 },
                },
              },
            };
          }
          const messages = (p.upstreamBody as { messages: Array<Record<string, unknown>> })
            .messages;
          capturedToolResultContent = messages.find((m) => m.role === "tool")?.content as string;
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
              json: {
                choices: [{ message: { role: "assistant", content: "Found some cat info!" } }],
                usage: { prompt_tokens: 20, completion_tokens: 8 },
              },
            },
          };
        },
        getToolSet: (await import("../../src/lib/mcp/nativeToolSet.ts")).getNativeToolSet,
        connectClient: (await import("../../src/lib/mcp/client.ts")).connectMcpClient,
        maxRounds: 5,
        roundTimeoutMs: 15000,
        totalTimeoutMs: 90000,
        toolCallTimeoutMs: 15000,
        toolResultMaxChars: 4000,
      }
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.finalText, "Found some cat info!");
    assert.equal(round, 2);
    assert.ok(
      capturedToolResultContent.includes("Real Cats"),
      "expected the REAL web_search tool's parsed result to reach the tool message, proving the full DB row -> nativeToolSet -> connectMcpClient -> builtin MCP server -> web_search tool -> loop chain actually ran"
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
