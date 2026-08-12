// src/app/api/keys/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { issueApiKey } from "@/lib/auth/apiKeys.ts";

const IssueKeySchema = z.object({
  label: z.string().min(1),
  toolMode: z.enum(["native", "trigger", "off"]).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = IssueKeySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const { id, secret } = issueApiKey(parsed.data.label, parsed.data.toolMode ?? "off");
    return new Response(JSON.stringify({ id, secret }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/keys] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
