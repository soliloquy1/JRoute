// src/app/api/rich-presets/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { createRichPreset, listRichPresets } from "@/lib/db/richPresets.ts";
import { RichPresetJsonSchema } from "@/lib/prompts/stPresetSchema.ts";
import { describeIssues } from "@/lib/api/validation.ts";

const CreateSchema = z.object({
  name: z.string().min(1),
  raw: RichPresetJsonSchema,
  charName: z.string().optional(),
  userName: z.string().optional(),
});

export async function GET(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  return new Response(JSON.stringify(listRichPresets()), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      // Issue detail matters here: a SillyTavern import that fails validation with a
      // bare "Invalid request body" is indistinguishable from "nothing happened".
      return jsonError(400, `Invalid request body — ${describeIssues(parsed.error)}`);
    }
    const id = createRichPreset(parsed.data.name, parsed.data.raw, {
      charName: parsed.data.charName,
      userName: parsed.data.userName,
    });
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return jsonError(409, "A rich preset with this name already exists");
    }
    console.error("[api/rich-presets] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
