// src/app/api/connections/[id]/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { updateConnection, deleteConnection } from "@/lib/db/connections.ts";

const PatchConnectionSchema = z
  .object({
    label: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    priority: z.number().int().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field required");

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = PatchConnectionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { id } = await params;
    updateConnection(Number(id), parsed.data);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/connections/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { id } = await params;
    deleteConnection(Number(id));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/connections/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
