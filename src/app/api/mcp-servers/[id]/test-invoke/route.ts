// src/app/api/mcp-servers/[id]/test-invoke/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError, sanitizeErrorMessage } from "@jroute/errors.ts";
import { getMcpServer } from "@/lib/db/mcpServers.ts";
import { connectMcpClient } from "@/lib/mcp/client.ts";

const InvokeSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = InvokeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { id } = await params;
    const server = getMcpServer(Number(id));
    if (!server) return jsonError(404, "Server not found");
    let client: Awaited<ReturnType<typeof connectMcpClient>> | undefined;
    try {
      client = await connectMcpClient(server);
      const result = await client.callTool({
        name: parsed.data.toolName,
        arguments: parsed.data.args ?? {},
      });
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } finally {
      await client?.close().catch(() => {});
    }
  } catch (err) {
    console.error("[api/mcp-servers/:id/test-invoke] unhandled error:", err);
    return jsonError(
      502,
      sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) ||
        "Tool invocation failed"
    );
  }
}
