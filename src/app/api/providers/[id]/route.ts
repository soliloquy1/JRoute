// src/app/api/providers/[id]/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { getProvider, upsertProvider, deleteProvider } from "@/lib/db/providers.ts";

const PatchProviderSchema = z
  .object({
    name: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    wireFormat: z.enum(["openai", "anthropic", "gemini"]).optional(),
    kind: z.enum(["apikey", "oauth"]).optional(),
    enabled: z.boolean().optional(),
    modelPrefix: z
      .string()
      .regex(/^[a-z0-9]*$/, "Model prefix must be empty or lowercase alphanumerics")
      .refine((v) => !v.includes("/"), "Model prefix must not contain '/'")
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field required");

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = PatchProviderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { id } = await params;
    const existing = getProvider(id);
    if (!existing) return jsonError(404, "Provider not found");
    try {
      upsertProvider({
        ...existing,
        ...parsed.data,
        modelPrefix: parsed.data.modelPrefix ?? existing.modelPrefix,
      });
    } catch (e) {
      return jsonError(400, (e as Error).message);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/providers/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { id } = await params;
    deleteProvider(id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/providers/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
