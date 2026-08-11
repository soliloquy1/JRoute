// src/lib/mcp/registry.ts
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface OpenAiToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export async function discoverTools(client: Client): Promise<OpenAiToolDef[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema,
    },
  }));
}

/**
 * Design spec §8: "Per-key allowlist controls what is advertised." Allowlist is opt-IN — a
 * `null` or empty allowlist exposes nothing, matching the `mcp_servers.tool_allowlist`
 * column's nullable, comma-separated-names design (Plan 3). Silently drops names that don't
 * match any discovered tool rather than erroring, since a stale allowlist entry (the server's
 * tool set changed) should degrade gracefully, not break every request.
 */
export function filterToolsForAllowlist(
  tools: OpenAiToolDef[],
  toolAllowlist: string | null
): OpenAiToolDef[] {
  if (!toolAllowlist) return [];
  const allowed = new Set(
    toolAllowlist
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
  return tools.filter((t) => allowed.has(t.function.name));
}
