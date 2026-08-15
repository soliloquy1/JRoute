// src/app/api/providers/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { upsertProvider } from "@/lib/db/providers.ts";

const ProviderSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Provider id must be lowercase alphanumerics or dashes"),
  name: z.string().min(1),
  kind: z.enum(["apikey", "oauth"]),
  baseUrl: z.string().url(),
  wireFormat: z.enum(["openai", "anthropic", "gemini"]),
  enabled: z.boolean(),
  modelPrefix: z
    .string()
    .regex(/^[a-z0-9]*$/, "Model prefix must be empty or lowercase alphanumerics")
    .refine((v) => !v.includes("/"), "Model prefix must not contain '/'")
    .optional()
    .default(""),
  oauthProvider: z.string().min(1).optional(),
  providerSpecificData: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = ProviderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    try {
      const d = parsed.data;
      upsertProvider({
        ...d,
        providerSpecificData: d.providerSpecificData
          ? JSON.stringify(d.providerSpecificData)
          : null,
      });
    } catch (e) {
      return jsonError(400, (e as Error).message);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/providers] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
