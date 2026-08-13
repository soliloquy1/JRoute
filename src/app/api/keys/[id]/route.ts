// src/app/api/keys/[id]/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { setApiKeyPreset, setApiKeyRichPreset, revokeApiKey } from "@/lib/auth/apiKeys.ts";

const PatchKeySchema = z.object({
  presetId: z.number().int().nullable().optional(),
  richPresetId: z.number().int().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = PatchKeySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { id } = await params;
    if (!Number.isInteger(Number(id))) return jsonError(400, "Invalid id");
    if (parsed.data.richPresetId !== undefined) {
      setApiKeyRichPreset(Number(id), parsed.data.richPresetId);
    } else if (parsed.data.presetId !== undefined) {
      setApiKeyPreset(Number(id), parsed.data.presetId);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/keys/:id] unhandled error:", err);
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
    if (!Number.isInteger(Number(id))) return jsonError(400, "Invalid id");
    revokeApiKey(Number(id));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/keys/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
