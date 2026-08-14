// src/app/api/providers/[id]/import-models/route.ts
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { getProvider } from "@/lib/db/providers.ts";
import { listConnections } from "@/lib/db/connections.ts";
import { importModels } from "@/lib/db/models.ts";
import { pullProviderModelIds } from "@/lib/dashboard/importProviderModels.ts";

/**
 * Pulls the provider's live model list and bulk-inserts them (idempotent).
 * - openai / openai-compatible: GET {baseUrl}/models  (Authorization: Bearer <key>)
 * - gemini: GET {baseUrl}/v1beta/models?key=<key>
 * - anthropic: refused — Anthropic exposes no public model-list endpoint.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const { id } = await params;
    const provider = getProvider(id);
    if (!provider) return jsonError(404, "Provider not found");

    if (provider.wireFormat === "anthropic") {
      return jsonError(
        400,
        "Anthropic has no public model list to import from. Add models manually."
      );
    }

    const connection = listConnections(id).find((c) => c.apiKey);
    if (!connection?.apiKey) {
      return jsonError(400, "Add a connection with an API key before importing models.");
    }

    let ids: string[];
    try {
      ids = await pullProviderModelIds(provider, connection.apiKey);
    } catch (e) {
      return jsonError(502, (e as Error).message);
    }

    if (ids.length === 0) {
      return new Response(JSON.stringify({ ok: true, imported: 0, total: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const imported = importModels(id, ids.map((modelId) => ({ id: modelId })));
    return new Response(JSON.stringify({ ok: true, imported, total: ids.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/providers/:id/import-models] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
