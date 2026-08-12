// src/app/api/prompt-blocks/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { createPromptBlock } from "@/lib/db/promptBlocks.ts";

const CreateSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["prepend", "append"]),
  content: z.string(),
});

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const id = createPromptBlock(parsed.data.name, parsed.data.kind, parsed.data.content);
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/prompt-blocks] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
