// src/app/api/providers/[id]/route.ts
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { deleteProvider } from "@/lib/db/providers.ts";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { id } = await params;
    deleteProvider(id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/providers/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
