// src/app/api/preview/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { buildPreview } from "@/lib/dashboard/preview.ts";
import { warmUpSandbox } from "@/lib/lorebooks/sandbox.ts";

const PreviewSchema = z.object({
  presetId: z.number().int(),
  wireFormat: z.enum(["openai", "anthropic", "gemini"]),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = PreviewSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    // buildPreview runs real lorebooks through the QuickJS sandbox, which is inert until
    // warmed (runLorebook returns kind:"error" cold and the runner silently skips the
    // lorebook). The only other warm-up call site is the chat route's module side effect,
    // so a dashboard-only session would otherwise render previews with every lorebook
    // silently missing. Memoized after the first call — cheap on subsequent requests.
    await warmUpSandbox();
    const result = buildPreview(parsed.data.presetId, parsed.data.wireFormat);
    if (!result) {
      return jsonError(
        404,
        "Preset not found, no converter for this format, or no model configured for it"
      );
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/preview] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
