// src/app/api/regex-presets/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import {
  createRegexPreset,
  listRegexPresets,
  InvalidRegexScriptError,
} from "@/lib/db/regexPresets.ts";
import { RegexScriptsSchema } from "@/lib/prompts/regexScriptSchema.ts";
import { describeIssues } from "@/lib/api/validation.ts";

const CreateSchema = z.object({
  name: z.string().min(1),
  scripts: RegexScriptsSchema,
});

export async function GET(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  return new Response(JSON.stringify(listRegexPresets()), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(400, `Invalid request body — ${describeIssues(parsed.error)}`);
    }
    const id = createRegexPreset(parsed.data.name, parsed.data.scripts);
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof InvalidRegexScriptError) {
      return jsonError(400, err.message);
    }
    if (err instanceof Error && "code" in err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return jsonError(409, "A regex preset with this name already exists");
    }
    console.error("[api/regex-presets] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
