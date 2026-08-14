// src/lib/dashboard/presetUsage.ts
import type { ApiKeyRecord } from "@/lib/db/types.ts";

/**
 * Map of richPresetId -> list of key labels currently assigned to that preset.
 * Only `rich_preset_id` counts (the simple `preset_id` path is a different preset kind and
 * is mutually exclusive). A preset absent from the map is "off" (assigned to no key).
 * Stable, serializable output for passing into the client editor as a prop.
 */
export function richPresetKeyLabels(keys: ApiKeyRecord[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const k of keys) {
    if (k.richPresetId === null) continue;
    (out[k.richPresetId] ??= []).push(k.label);
  }
  return out;
}
