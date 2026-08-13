// src/app/api/rich-presets/[id]/lorebooks/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { getRichPreset, setRichPresetLorebooks } from "@/lib/db/richPresets.ts";
import { parseIdParam } from "@/lib/api/validation.ts";

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
    const id = parseIdParam((await params).id);
    if (id === null) return jsonError(400, "Invalid id");
    if (!getRichPreset(id)) return jsonError(404, "Rich preset not found");
    setRichPresetLorebooks(id, parsed.data.lorebookIds);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    // FK violation = a lorebook id that doesn't exist (foreign_keys = ON in bootstrap).
    if (err instanceof Error && "code" in err && err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return jsonError(400, "Unknown lorebook id");
    }
    console.error("[api/rich-presets/:id/lorebooks] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
