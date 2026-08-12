// src/app/api/connections/reorder/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { reorderConnections } from "@/lib/db/connections.ts";

const ReorderSchema = z.object({
  orderedIds: z.array(z.number().int()).min(1),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = ReorderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    reorderConnections(parsed.data.orderedIds);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/connections/reorder] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
