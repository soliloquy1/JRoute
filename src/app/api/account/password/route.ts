// src/app/api/account/password/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { verifyCurrentPassword, changePassword } from "@/lib/auth/sessions.ts";

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export async function PATCH(req: Request): Promise<Response> {
  const userId = authenticateDashboard(req);
  if (!userId) return jsonError(401, "Unauthorized");
  try {
    const parsed = ChangePasswordSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { currentPassword, newPassword } = parsed.data;
    const ok = await verifyCurrentPassword(userId, currentPassword);
    if (!ok) return jsonError(401, "Current password is incorrect");
    changePassword(userId, newPassword);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/account/password] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
