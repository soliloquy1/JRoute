// src/lib/mcp/client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { mcpSafeFetch } from "./ssrfFetch.ts";
import type { McpServer } from "../db/types.ts";

/**
 * Design spec §8.1 control 3: stdio transport is opt-in via env, off by default. This is
 * enforced here at connection time (not "at boot" literally, since JRoute has no persistent
 * boot-time cache of this value in this plan — reading it per-connection-attempt is
 * equivalent and simpler, and env vars do not change during a running process).
 */
function assertStdioAuthorized(server: McpServer): void {
  if (process.env.JROUTE_ALLOW_REMOTE_STDIO !== "1") {
    throw new Error(
      `stdio MCP server "${server.name}" requires JROUTE_ALLOW_REMOTE_STDIO=1 (unset by default)`
    );
  }
  // Design spec §8.1 control 4: operator confirmation before first spawn. Controls 1/2 (auth
  // + peer-address classification on the config route that WRITES confirmedAt) belong to the
  // dashboard, which does not exist yet in JRoute (Plan 7) — this check is defense-in-depth
  // ahead of that UI: confirmMcpServer() (Plan 3, src/lib/db/mcpServers.ts) is the only way
  // confirmedAt gets set today, and nothing in this plan calls it automatically.
  if (server.confirmedAt === null) {
    throw new Error(
      `stdio MCP server "${server.name}" has not been operator-confirmed (confirmedAt is null)`
    );
  }
}

function buildTransport(server: McpServer): Transport {
  switch (server.transport) {
    case "http":
      return new StreamableHTTPClientTransport(new URL(server.target), { fetch: mcpSafeFetch });
    case "sse":
      return new SSEClientTransport(new URL(server.target), { fetch: mcpSafeFetch });
    case "stdio": {
      assertStdioAuthorized(server);
      // server.target for stdio is a shell command string, e.g. "node ./tool.js"; split on
      // whitespace for command + args, matching the SDK's StdioServerParameters shape.
      const [command, ...args] = server.target.split(/\s+/);
      return new StdioClientTransport({ command, args });
    }
    default:
      throw new Error(`Unknown MCP transport: ${(server as { transport: string }).transport}`);
  }
}

export async function connectMcpClient(server: McpServer): Promise<Client> {
  const transport = buildTransport(server);
  const client = new Client({ name: "jroute", version: "0.1.0" });
  await client.connect(transport);
  return client;
}
