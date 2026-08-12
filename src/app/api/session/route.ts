import { z } from "zod";
import {
  verifyPassword,
  createSession,
  destroySession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth/sessions.ts";
import { jsonError } from "@jroute/errors.ts";

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Vendored from feat/jroute-plan7-dashboard-shell (Plan 8 shell vendor commit). Plan 7's
 * version imports `readCookie` from `@/lib/auth/guard.ts`, which that branch exports but
 * this branch's guard.ts keeps private — guard.ts is outside this plan's scope to modify,
 * so the cookie read is inlined here instead. Behavior is identical.
 */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function cookieHeader(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = LoginSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");

    const userId = await verifyPassword(parsed.data.username, parsed.data.password);
    if (userId === null) return jsonError(401, "Invalid username or password");

    const token = createSession(userId);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": cookieHeader(token, SESSION_TTL_MS / 1000),
      },
    });
  } catch (err) {
    console.error("[api/session] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) destroySession(token);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": cookieHeader("", 0),
      },
    });
  } catch (err) {
    console.error("[api/session] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
