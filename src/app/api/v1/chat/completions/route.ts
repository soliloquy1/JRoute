// src/app/api/v1/chat/completions/route.ts
import { jsonError } from "@jroute/errors.ts";
import { handleChat } from "@jroute/handleChat.ts";
import { authenticateProxy, corsHeadersFor } from "@/lib/auth/guard.ts";
import { warmUpSandbox } from "@/lib/lorebooks/sandbox.ts";

warmUpSandbox().catch(() => {});

const CORS = corsHeadersFor("/v1/chat/completions", null);

export async function OPTIONS(_req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request): Promise<Response> {
  const key = authenticateProxy(req);
  if (!key) return jsonError(401, "Invalid API key", CORS);
  try {
    const res = await handleChat(req, key);
    // Only Access-Control-* keys are written here, so a streaming response keeps its
    // own content-type / cache-control / x-accel-buffering intact.
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  } catch (err) {
    // handleChat guards its own req.json(), but a throw from the DB layer
    // (getProvider / listConnections / logUsage — logUsage runs on EVERY request)
    // would otherwise escape to Next's default 500, which carries NO CORS headers.
    // The browser then shows the chatter an opaque CORS failure instead of the error,
    // and a dev build renders a stack into it. Log server-side (never swallow silently),
    // return a sanitized 500 that still carries CORS.
    console.error("[chat] unhandled error from handleChat:", err);
    return jsonError(500, "Internal error", CORS);
  }
}
