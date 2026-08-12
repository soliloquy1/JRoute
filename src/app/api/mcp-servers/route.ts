// src/app/api/mcp-servers/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { createMcpServer } from "@/lib/db/mcpServers.ts";

const CreateSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(["http", "sse", "stdio"]),
  target: z.string().min(1),
  enabled: z.boolean().optional(),
  toolAllowlist: z.string().optional(),
  triggerPattern: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { name, transport, target, ...opts } = parsed.data;
    const id = createMcpServer(name, transport, target, opts);
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/mcp-servers] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
