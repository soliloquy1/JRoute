// src/app/api/keys/[id]/route.ts
import { z } from "zod";
import { authenticateDashboard } from "@/lib/auth/guard.ts";
import { jsonError } from "@jroute/errors.ts";
import {
  setApiKeyPreset,
  setApiKeyRichPreset,
  setApiKeyLogitBiasPreset,
  setApiKeyRegexPreset,
  revokeApiKey,
} from "@/lib/auth/apiKeys.ts";
import { parseIdParam } from "@/lib/api/validation.ts";

const PatchKeySchema = z.object({
  presetId: z.number().int().nullable().optional(),
  richPresetId: z.number().int().nullable().optional(),
  logitBiasPresetId: z.number().int().nullable().optional(),
  regexPresetId: z.number().int().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!authenticateDashboard(req)) return jsonError(401, "Unauthorized");
  try {
    const parsed = PatchKeySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Invalid request body");
    const id = parseIdParam((await params).id);
    if (id === null) return jsonError(400, "Invalid id");
    if (parsed.data.richPresetId !== undefined) {
      setApiKeyRichPreset(id, parsed.data.richPresetId);
    } else if (parsed.data.presetId !== undefined) {
      setApiKeyPreset(id, parsed.data.presetId);
    }
    if (parsed.data.logitBiasPresetId !== undefined) {
      setApiKeyLogitBiasPreset(id, parsed.data.logitBiasPresetId);
    }
    if (parsed.data.regexPresetId !== undefined) {
      setApiKeyRegexPreset(id, parsed.data.regexPresetId);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    // Assigning a preset id that doesn't exist trips the FK on api_keys — that's a
    // client error (stale dropdown), not a server fault.
    if (err instanceof Error && "code" in err && err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return jsonError(400, "Unknown preset id");
    }
    console.error("[api/keys/:id] unhandled error:", err);
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
    revokeApiKey(id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[api/keys/:id] unhandled error:", err);
    return jsonError(500, "Internal error");
  }
}
