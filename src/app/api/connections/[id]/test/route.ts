// src/app/api/connections/[id]/test/route.ts
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { testConnection } from "@/lib/dashboard/testConnection.ts";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { id } = await params;
    const connectionId = Number(id);
    if (!Number.isInteger(connectionId)) return jsonError(400, "Invalid connection id");
    const result = await testConnection(connectionId);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/connections/:id/test] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
