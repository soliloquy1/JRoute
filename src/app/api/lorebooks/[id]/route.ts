// src/app/api/lorebooks/[id]/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { updateLorebook, deleteLorebook } from "@/lib/db/lorebooks.ts";

const PatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    source: z.string().optional(),
    enabled: z.boolean().optional(),
    triggerConfig: z.string().nullable().optional(),
    scope: z.enum(["character", "global"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field required");

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { id } = await params;
    updateLorebook(Number(id), parsed.data);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/lorebooks/:id] unhandled error:", err);
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
    deleteLorebook(Number(id));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/lorebooks/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
