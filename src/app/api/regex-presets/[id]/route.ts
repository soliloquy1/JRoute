// src/app/api/regex-presets/[id]/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import {
  getRegexPreset,
  updateRegexPreset,
  deleteRegexPreset,
  InvalidRegexScriptError,
} from "@/lib/db/regexPresets.ts";
import { RegexScriptsSchema } from "@/lib/prompts/regexScriptSchema.ts";
import { describeIssues, parseIdParam } from "@/lib/api/validation.ts";

const PatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    scripts: RegexScriptsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field required");

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  const id = parseIdParam((await params).id);
  if (id === null) return jsonError(400, "Invalid id");
  const preset = getRegexPreset(id);
  if (!preset) return jsonError(404, "Regex preset not found");
  return new Response(JSON.stringify(preset), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(400, `Invalid request body — ${describeIssues(parsed.error)}`);
    }
    const id = parseIdParam((await params).id);
    if (id === null) return jsonError(400, "Invalid id");
    if (!getRegexPreset(id)) return jsonError(404, "Regex preset not found");
    updateRegexPreset(id, parsed.data);
    return new Response(JSON.stringify({ ok: true }), {
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
    console.error("[api/regex-presets/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const id = parseIdParam((await params).id);
    if (id === null) return jsonError(400, "Invalid id");
    if (!getRegexPreset(id)) return jsonError(404, "Regex preset not found");
    deleteRegexPreset(id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/regex-presets/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
