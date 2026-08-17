// src/app/api/settings/fallback-strategy/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { getFallbackStrategy, setFallbackStrategy } from "@/lib/db/settings.ts";

export async function GET(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  return new Response(JSON.stringify({ strategy: getFallbackStrategy() }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const PatchSchema = z.object({ strategy: z.enum(["priority", "round-robin"]) });

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid request body");
  setFallbackStrategy(parsed.data.strategy);
  return new Response(JSON.stringify({ ok: true, strategy: parsed.data.strategy }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
