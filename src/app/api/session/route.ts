import { z } from "zod";
import {
  verifyPassword,
  createSession,
  destroySession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth/sessions.ts";
import { readCookie } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

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
