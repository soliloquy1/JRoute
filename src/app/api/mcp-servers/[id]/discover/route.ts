// src/app/api/mcp-servers/[id]/discover/route.ts
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError, sanitizeErrorMessage } from "@jroute/errors.ts";
import { getMcpServer } from "@/lib/db/mcpServers.ts";
import { connectMcpClient } from "@/lib/mcp/client.ts";
import { discoverTools, filterToolsForAllowlist } from "@/lib/mcp/registry.ts";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { id } = await params;
    const server = getMcpServer(Number(id));
    if (!server) return jsonError(404, "Server not found");
    let client: Awaited<ReturnType<typeof connectMcpClient>> | undefined;
    try {
      client = await connectMcpClient(server);
      const tools = await discoverTools(client);
      const filtered = filterToolsForAllowlist(tools, server.toolAllowlist);
      return new Response(JSON.stringify({ tools: filtered }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } finally {
      await client?.close().catch(() => {});
    }
  } catch (err) {
    console.error("[api/mcp-servers/:id/discover] unhandled error:", err);
    return jsonError(
      502,
      sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) ||
        "Failed to connect to MCP server"
    );
  }
}
