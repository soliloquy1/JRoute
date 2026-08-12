// src/app/api/presets/[id]/lorebooks/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { setPresetLorebooks } from "@/lib/db/presets.ts";

const SetLorebooksSchema = z.object({
  lorebookIds: z.array(z.number().int()),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = SetLorebooksSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { id } = await params;
    setPresetLorebooks(Number(id), parsed.data.lorebookIds);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/presets/:id/lorebooks] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
