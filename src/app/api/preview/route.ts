// src/app/api/preview/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { buildPreview } from "@/lib/dashboard/preview.ts";

const PreviewSchema = z.object({
  presetId: z.number().int(),
  wireFormat: z.enum(["openai", "anthropic", "gemini"]),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = PreviewSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const result = buildPreview(parsed.data.presetId, parsed.data.wireFormat);
    if (!result) {
      return jsonError(
        404,
        "Preset not found, no converter for this format, or no model configured for it"
      );
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/preview] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
