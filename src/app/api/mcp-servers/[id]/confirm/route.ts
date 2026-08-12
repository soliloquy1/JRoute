// src/app/api/mcp-servers/[id]/confirm/route.ts
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { getMcpServer, confirmMcpServer } from "@/lib/db/mcpServers.ts";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { id } = await params;
    const server = getMcpServer(Number(id));
    if (!server) return jsonError(404, "Server not found");
    if (server.transport !== "stdio") {
      return jsonError(400, "Only stdio servers require confirmation");
    }
    confirmMcpServer(Number(id));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/mcp-servers/:id/confirm] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
