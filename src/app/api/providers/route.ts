// src/app/api/providers/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { upsertProvider } from "@/lib/db/providers.ts";

const ProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["apikey", "oauth"]),
  baseUrl: z.string().url(),
  wireFormat: z.enum(["openai", "anthropic", "gemini"]),
  enabled: z.boolean(),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = ProviderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    upsertProvider(parsed.data);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/providers] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
