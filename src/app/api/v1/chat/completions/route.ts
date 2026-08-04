// src/app/api/v1/chat/completions/route.ts
import { jsonError } from "@jroute/errors.ts";
import { handleChat } from "@jroute/handleChat.ts";
import { authenticateProxy, corsHeadersFor } from "@/lib/auth/guard.ts";

const CORS = corsHeadersFor("/v1/chat/completions", null);

export async function OPTIONS(_req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request): Promise<Response> {
  const key = authenticateProxy(req);
  if (!key) return jsonError(401, "Invalid API key", CORS);
  const res = await handleChat(req, key);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}
