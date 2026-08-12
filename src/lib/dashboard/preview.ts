// src/lib/dashboard/preview.ts
import { resolveSystemBlocks } from "@/lib/prompts/assemble.ts";
import { runLorebooksForRequest } from "@/lib/lorebooks/runner.ts";
import { getPreset } from "@/lib/db/presets.ts";
import { getProvider } from "@/lib/db/providers.ts";
import { getConverter } from "@jroute/convert/registry.ts";
import { listModelIds, lookupModel } from "@jroute/convert/models.ts";
import type { WireFormat } from "@/lib/db/types.ts";

/**
 * Fixed on purpose — see "Preview isolation" in this plan's header. Never let the operator
 * supply their own sample text here; that would reopen the exact real-variable-mutation
 * hazard this constant closes.
 */
export const PREVIEW_SCOPE_MARKER = "[JRoute Preview Card — do not use as a real character]";

const SAMPLE_MESSAGES = [
  { role: "system", content: "You are a helpful character." },
  { role: "user", content: "Hello!" },
];

export interface PreviewResult {
  upstreamBody: Record<string, unknown>;
}

export function buildPreview(presetId: number, wireFormat: WireFormat): PreviewResult | null {
  const preset = getPreset(presetId);
  if (!preset) return null;

  const converter = getConverter(wireFormat);
  if (!converter) return null;

  const model = listModelIds().find((id) => {
    const entry = lookupModel(id);
    if (!entry) return false;
    return getProvider(entry.providerId)?.wireFormat === wireFormat;
  });
  if (!model) return null;
  const maxTokens = lookupModel(model)!.maxTokens;

  const systemBlocks = resolveSystemBlocks(presetId);
  const lorebookBlocks =
    preset.lorebookIds.length > 0
      ? runLorebooksForRequest({
          lorebookIds: preset.lorebookIds,
          messages: SAMPLE_MESSAGES,
          rawSystemPrompt: PREVIEW_SCOPE_MARKER,
        })
      : [];

  const upstreamBody = converter.convertRequest({
    model,
    maxTokens,
    body: { model, messages: SAMPLE_MESSAGES },
    blocks: [...systemBlocks, ...lorebookBlocks],
  });

  return { upstreamBody };
}
