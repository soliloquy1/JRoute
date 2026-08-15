// src/app/api/connections/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { createConnection } from "@/lib/db/connections.ts";

const CreateConnectionSchema = z.object({
  providerId: z.string().min(1),
  label: z.string().min(1),
  apiKey: z.string().min(1),
  providerSpecificData: z.record(z.string(), z.unknown()).optional(),
  quotaWindowThresholds: z
    .object({
      requests: z.number().int().positive().optional(),
      tokens: z.number().int().positive().optional(),
      windowMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = CreateConnectionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { providerId, label, apiKey, providerSpecificData, quotaWindowThresholds } = parsed.data;
    const id = createConnection(providerId, label, apiKey, {
      providerSpecificData: providerSpecificData
        ? JSON.stringify(providerSpecificData)
        : null,
      quotaWindowThresholds: quotaWindowThresholds
        ? JSON.stringify(quotaWindowThresholds)
        : null,
    });
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/connections] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
