// src/app/api/rich-presets/[id]/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import { getRichPreset, updateRichPreset, deleteRichPreset } from "@/lib/db/richPresets.ts";
import { RichPresetJsonSchema } from "@/lib/prompts/stPresetSchema.ts";
import { ReasoningTagPairsSchema } from "@/lib/prompts/reasoningTagSchema.ts";
import { describeIssues, parseIdParam } from "@/lib/api/validation.ts";

const PatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    raw: RichPresetJsonSchema.optional(),
    charName: z.string().optional(),
    userName: z.string().optional(),
    reasoningTags: ReasoningTagPairsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field required");

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  const id = parseIdParam((await params).id);
  if (id === null) return jsonError(400, "Invalid id");
  const preset = getRichPreset(id);
  if (!preset) return jsonError(404, "Rich preset not found");
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
    if (!getRichPreset(id)) return jsonError(404, "Rich preset not found");
    updateRichPreset(id, parsed.data);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return jsonError(409, "A rich preset with this name already exists");
    }
    console.error("[api/rich-presets/:id] unhandled error:", err);
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
    if (!getRichPreset(id)) return jsonError(404, "Rich preset not found");
    deleteRichPreset(id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/rich-presets/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
