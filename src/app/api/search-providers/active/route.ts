// src/app/api/search-providers/active/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { getActiveSearchProviderId, setActiveSearchProviderId } from "@/lib/db/settings.ts";
import { getSearchProvider } from "@/lib/db/searchProviders.ts";

const PutSchema = z.object({ id: z.number().int().nullable() });

export async function GET(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  return new Response(JSON.stringify({ id: getActiveSearchProviderId() }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function PUT(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = PutSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    // Reject ids that do not resolve to a row — otherwise the setting silently points at
    // nothing and every web_search call fails with "provider no longer exists".
    if (parsed.data.id !== null && !getSearchProvider(parsed.data.id))
      return jsonError(404, "Search provider not found");
    setActiveSearchProviderId(parsed.data.id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/search-providers/active] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
