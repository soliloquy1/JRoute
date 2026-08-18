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
        const buf = await res.arrayBuffer();
        const bounded = buf.byteLength > MAX_FETCH_BYTES ? buf.slice(0, MAX_FETCH_BYTES) : buf;
        const html = Buffer.from(bounded).toString("utf8");
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
