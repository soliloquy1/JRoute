// src/app/api/models/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { getProvider } from "@/lib/db/providers.ts";
import { modelExists, createModel } from "@/lib/db/models.ts";

const CreateModelSchema = z.object({
  providerId: z.string().min(1),
  // Native ids may contain "/" (aggregate gateways like OpenRouter, e.g.
  // "openai/gpt-4o") — resolveClientModel() only splits on the FIRST "/",
  // owned by the provider's model_prefix, so the rest is free to contain more.
  modelId: z.string().min(1),
  maxTokens: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = CreateModelSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { providerId, modelId, maxTokens, enabled } = parsed.data;
    if (!getProvider(providerId)) return jsonError(404, "Provider not found");
    if (modelExists(providerId, modelId)) return jsonError(409, "Model already exists for provider");
    const model = createModel(providerId, modelId, maxTokens ?? 8192, enabled ?? true);
    return new Response(JSON.stringify({ ok: true, model }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/models] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
