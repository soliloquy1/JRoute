// src/app/api/logit-bias-presets/[id]/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import {
  getLogitBiasPreset,
  updateLogitBiasPreset,
  deleteLogitBiasPreset,
} from "@/lib/db/logitBiasPresets.ts";
import { LogitBiasEntriesSchema } from "@/lib/prompts/logitBiasSchema.ts";
import { describeIssues, parseIdParam } from "@/lib/api/validation.ts";

const PatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    entries: LogitBiasEntriesSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field required");

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  const id = parseIdParam((await params).id);
  if (id === null) return jsonError(400, "Invalid id");
  const preset = getLogitBiasPreset(id);
  if (!preset) return jsonError(404, "Logit bias preset not found");
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
    if (!getLogitBiasPreset(id)) return jsonError(404, "Logit bias preset not found");
    updateLogitBiasPreset(id, parsed.data);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return jsonError(409, "A logit bias preset with this name already exists");
    }
    console.error("[api/logit-bias-presets/:id] unhandled error:", err);
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
    if (!getLogitBiasPreset(id)) return jsonError(404, "Logit bias preset not found");
    deleteLogitBiasPreset(id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/logit-bias-presets/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
