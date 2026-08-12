// src/app/api/presets/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { createPreset } from "@/lib/db/presets.ts";

const CreateSchema = z.object({
  name: z.string().min(1),
  toolMode: z.enum(["native", "trigger", "off"]).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const id = createPreset(parsed.data.name, { toolMode: parsed.data.toolMode });
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/presets] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
