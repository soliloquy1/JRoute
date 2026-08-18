// src/lib/mcp/builtinSearchServer.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getActiveSearchProviderId } from "../db/settings.ts";
import { getSearchProvider } from "../db/searchProviders.ts";
import * as searchBackends from "../search/backends/index.ts";
import { htmlToText } from "../search/htmlToText.ts";
import { mcpSafeFetch } from "./ssrfFetch.ts";

const MAX_QUERY_LENGTH = 500;
const MAX_FETCH_BYTES = 2 * 1024 * 1024;
const MAX_FETCH_TEXT_LENGTH = 8000;
const MAX_RESULTS = 5;

type GetBackendFn = typeof searchBackends.getBackend;

function errorContent(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

function textContent(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Reads at most `maxBytes` of a response body and decodes it as UTF-8.
 *
 * `mcpSafeFetch` blocks private-network targets but puts no ceiling on the body size, so
 * `res.arrayBuffer()` would allocate the whole (attacker-chosen) payload before any cap could
 * be applied. Read the stream incrementally instead and cancel it the moment the budget is
 * spent, so the cap actually bounds memory. Exported for direct unit testing — the SSRF gate
 * makes it impractical to exercise this path through a real `web_fetch` call.
 */
export async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (value.byteLength >= remaining) {
        chunks.push(value.subarray(0, remaining));
        total = maxBytes;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

/**
 * Builds the first-party, in-process MCP server that backs the `builtin` transport.
 * Exposes `web_search` (operator-configured search API) and `web_fetch` (SSRF-filtered
 * page fetch + plain-text extraction). `getBackendImpl` is injectable for tests; production
 * callers (Task 7's `buildTransport`) never pass it and get the real backend registry.
 */
export function createBuiltinSearchServer(
  getBackendImpl: GetBackendFn = searchBackends.getBackend
): Server {
  const server = new Server(
    { name: "jroute-search", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "web_search",
        description: "Search the web and return top results.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      {
        name: "web_fetch",
        description: "Fetch a web page and return its visible text content.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "web_search") {
      const query = typeof args?.query === "string" ? args.query.slice(0, MAX_QUERY_LENGTH) : "";
      if (!query) return errorContent("web_search requires a non-empty query");

      const providerId = getActiveSearchProviderId();
      if (providerId === null) return errorContent("no search provider configured");
      const provider = getSearchProvider(providerId);
      if (!provider) return errorContent("configured search provider no longer exists");
      if (provider.credentialDecryptFailed)
        return errorContent(
          "search provider api key could not be decrypted — STORAGE_ENCRYPTION_KEY may have changed"
        );
      if (!provider.apiKey) return errorContent("search provider has no api key configured");

      try {
        const backend = getBackendImpl(provider.kind);
        const config = provider.configJson ? JSON.parse(provider.configJson) : null;
        const results = await backend.search(provider.apiKey, config, query);
        if (results.length === 0) return textContent("No results found.");
        const formatted = results
          .slice(0, MAX_RESULTS)
          .map((r) => `${r.title} — ${r.url}\n${r.snippet}`)
          .join("\n\n");
        return textContent(formatted);
      } catch {
        return errorContent("search provider returned an error");
      }
    }

    if (name === "web_fetch") {
      const url = typeof args?.url === "string" ? args.url : "";
      if (!url || !/^https?:\/\//i.test(url))
        return errorContent("web_fetch requires a valid http(s) url");

      try {
        const res = await mcpSafeFetch(url);
        const html = await readBoundedText(res, MAX_FETCH_BYTES);
        const text = htmlToText(html, MAX_FETCH_TEXT_LENGTH);
        return textContent(text || "(page had no extractable text)");
      } catch {
        return errorContent("could not fetch that url");
      }
    }

    return errorContent(`unknown tool: ${name}`);
  });

  return server;
}
