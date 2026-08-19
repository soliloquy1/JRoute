// src/lib/mcp/nativeToolSet.ts
//
// Native-mode tool advertising (design spec §4, §5.7): the union of tools from every enabled
// MCP server row whose `tool_allowlist` is non-empty, resolved through the same
// `discoverTools`/`filterToolsForAllowlist` pair the dashboard's MCP page already uses.
//
// Two behaviors worth knowing before changing anything here:
//   * Tool-name collisions resolve by server registration order (`listMcpServers()` is
//     `ORDER BY id`), first-wins. That is deterministic — it does not depend on which server
//     answered discovery fastest or which tool the model happened to pick.
//   * Discovery is cached per process with a 60s TTL because `discoverTools` opens a real
//     connection per server (a process spawn for stdio transports), which would otherwise be
//     paid on every native-mode chat request before round 1 even starts.
import { listMcpServers } from "../db/mcpServers.ts";
import { connectMcpClient } from "./client.ts";
import { discoverTools, filterToolsForAllowlist, type OpenAiToolDef } from "./registry.ts";
import { debugLog, debugLogError } from "../debugLog/logger.ts";
import type { McpServer } from "../db/types.ts";

const CACHE_TTL_MS = 60_000;
const DISCOVERY_TIMEOUT_MS = 10_000;

export interface NativeToolSet {
  /** Deduped by tool name, ready to assign to `body.tools`. */
  tools: OpenAiToolDef[];
  resolveServerForTool(toolName: string): McpServer | null;
}

let cached: {
  expiresAt: number;
  tools: OpenAiToolDef[];
  ownerByName: Map<string, McpServer>;
} | null = null;

export function clearNativeToolSetCacheForTests(): void {
  cached = null;
}

async function discoverOneServer(server: McpServer): Promise<OpenAiToolDef[]> {
  // The timer is cleared in `finally` so a fast discovery does not leave a pending 10s timer
  // holding the event loop open (which would keep `jroute dev` from exiting cleanly and, in
  // tests, keep the node:test runner alive past the last assertion).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const client = await Promise.race([
    connectMcpClient(server),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("discovery timeout")), DISCOVERY_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
  try {
    const discovered = await discoverTools(client);
    return filterToolsForAllowlist(discovered, server.toolAllowlist);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function getNativeToolSet(): Promise<NativeToolSet> {
  if (cached && cached.expiresAt > Date.now()) {
    const { tools, ownerByName } = cached;
    return { tools, resolveServerForTool: (name) => ownerByName.get(name) ?? null };
  }

  const servers = listMcpServers().filter((s) => s.enabled && s.toolAllowlist !== null);
  const ownerByName = new Map<string, McpServer>();
  const tools: OpenAiToolDef[] = [];

  for (const server of servers) {
    try {
      const serverTools = await discoverOneServer(server);
      for (const tool of serverTools) {
        const incumbent = ownerByName.get(tool.function.name);
        if (incumbent) {
          // First registration wins; the later duplicate is dropped, not merged or renamed.
          debugLog("mcp_native.tool_name_collision", {
            name: tool.function.name,
            wonServerId: incumbent.id,
            droppedServerId: server.id,
          });
          continue;
        }
        ownerByName.set(tool.function.name, server);
        tools.push(tool);
      }
    } catch (err) {
      // Per-server isolation (design spec §5.7): one unreachable MCP server must not fail the
      // whole request — its tools are simply absent from what gets advertised this round.
      debugLogError("mcp_native.discovery_failed", err, { serverId: server.id });
    }
  }

  cached = { expiresAt: Date.now() + CACHE_TTL_MS, tools, ownerByName };
  return { tools, resolveServerForTool: (name) => ownerByName.get(name) ?? null };
}
