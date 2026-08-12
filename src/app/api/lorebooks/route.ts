// src/app/api/lorebooks/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { createLorebook } from "@/lib/db/lorebooks.ts";

const CreateSchema = z.object({
  name: z.string().min(1),
  source: z.string(),
  enabled: z.boolean().optional(),
  triggerConfig: z.string().optional(),
  scope: z.enum(["character", "global"]).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { name, source, ...opts } = parsed.data;
    const id = createLorebook(name, source, opts);
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/lorebooks] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
