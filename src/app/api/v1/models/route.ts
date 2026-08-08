// src/app/api/v1/models/route.ts
import { corsHeadersFor } from "@/lib/auth/guard.ts";
import { getProvider } from "@/lib/db/providers.ts";
import { listConnections } from "@/lib/db/connections.ts";
import { listModelIds, lookupModel } from "@jroute/convert/models.ts";

const CORS = corsHeadersFor("/v1/models", null);

export async function OPTIONS(_req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Advertises real model ids, not provider ids.
 *
 * A model is listed only when it would actually be servable: its provider row exists, is
 * enabled, and has at least one connection. Advertising a model the proxy cannot reach
 * sends the chatter into a failure they cannot diagnose — the dropdown offered it.
 */
export async function GET(_req: Request): Promise<Response> {
  const data = listModelIds()
    .filter((id) => {
      const entry = lookupModel(id);
      if (!entry) return false;
      const provider = getProvider(entry.providerId);
      if (!provider || !provider.enabled) return false;
      return listConnections(entry.providerId).length > 0;
    })
    .map((id) => ({ id, object: "model", owned_by: "jroute" }));

  return new Response(JSON.stringify({ object: "list", data }), {
    status: 200,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
