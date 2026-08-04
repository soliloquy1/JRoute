// src/app/api/v1/models/route.ts
import { corsHeadersFor } from "@/lib/auth/guard.ts";
import { listProviders } from "@/lib/db/providers.ts";

const CORS = corsHeadersFor("/v1/models", null);

export async function OPTIONS(_req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(_req: Request): Promise<Response> {
  const data = listProviders()
    .filter((p) => p.enabled)
    .map((p) => ({ id: p.id, object: "model", owned_by: "jroute" }));
  return new Response(JSON.stringify({ object: "list", data }), {
    status: 200,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
