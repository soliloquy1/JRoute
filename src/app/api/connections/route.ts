// src/app/api/connections/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { createConnection } from "@/lib/db/connections.ts";

const CreateConnectionSchema = z.object({
  providerId: z.string().min(1),
  label: z.string().min(1),
  apiKey: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = CreateConnectionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const id = createConnection(parsed.data.providerId, parsed.data.label, parsed.data.apiKey);
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/connections] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
