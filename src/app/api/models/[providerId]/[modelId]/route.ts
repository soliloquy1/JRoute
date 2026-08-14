// src/app/api/models/[providerId]/[modelId]/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { getProvider } from "@/lib/db/providers.ts";
import { modelExists, updateModel, deleteModel } from "@/lib/db/models.ts";

const PatchModelSchema = z
  .object({
    maxTokens: z.number().int().positive().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field required");

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ providerId: string; modelId: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { providerId, modelId } = await params;
    const decodedModelId = decodeURIComponent(modelId);
    const parsed = PatchModelSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    if (!getProvider(providerId)) return jsonError(404, "Provider not found");
    if (!modelExists(providerId, decodedModelId)) return jsonError(404, "Model not found");
    updateModel(providerId, decodedModelId, parsed.data);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/models/:p/:m] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ providerId: string; modelId: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { providerId, modelId } = await params;
    const decodedModelId = decodeURIComponent(modelId);
    if (!getProvider(providerId)) return jsonError(404, "Provider not found");
    deleteModel(providerId, decodedModelId);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/models/:p/:m] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
