// src/app/api/search-providers/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { createSearchProvider, listSearchProviders } from "@/lib/db/searchProviders.ts";

const CreateSchema = z.object({
  kind: z.enum(["brave", "serpapi", "google_cse", "tavily"]),
  label: z.string().min(1),
  apiKey: z.string().min(1),
  configJson: z.string().nullable().optional(),
});

export async function GET(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const providers = listSearchProviders().map((p) => ({
      id: p.id,
      kind: p.kind,
      label: p.label,
      apiKeyMasked: p.apiKey && p.apiKey.length > 4 ? `••••${p.apiKey.slice(-4)}` : "••••",
      credentialDecryptFailed: p.credentialDecryptFailed,
      configJson: p.configJson,
      createdAt: p.createdAt,
    }));
    return new Response(JSON.stringify({ providers }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/search-providers] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { kind, label, apiKey, configJson } = parsed.data;
    const id = createSearchProvider(kind, label, apiKey, configJson ?? undefined);
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/search-providers] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
