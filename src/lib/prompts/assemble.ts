import { getPreset } from "../db/presets.ts";
import { getPromptBlock } from "../db/promptBlocks.ts";
import type { TaggedBlock } from "../../../jroute/convert/types.ts";

/**
 * Builds the `system-block` tagged blocks JRoute itself contributes to the prompt —
 * the preset's prepend and append text (design spec §6.1, §7.4). Janitor's own system
 * message is NOT produced here; every converter already hoists it separately by scanning
 * `body.messages` for `role: "system"` (Plan 2a/2c). This function's only job is JRoute's
 * own configured content.
 *
 * The `role` field carries a position convention the converters (Task 2-4 of this plan)
 * read to decide where the block lands relative to Janitor's system message:
 * `"system-prepend"` goes before it, `"system-append"` goes after. This is safe against
 * the frozen `TaggedBlock` union because `role` is untyped (`role: string`) by design.
 */
export function resolveSystemBlocks(presetId: number | null): TaggedBlock[] {
  if (presetId === null) return [];
  const preset = getPreset(presetId);
  if (!preset) return [];

  const out: TaggedBlock[] = [];

  if (preset.prependBlockId !== null) {
    const block = getPromptBlock(preset.prependBlockId);
    if (block && block.content.length > 0) {
      out.push({ role: "system-prepend", content: block.content, tag: "system-block" });
    }
  }

  if (preset.appendBlockId !== null) {
    const block = getPromptBlock(preset.appendBlockId);
    if (block && block.content.length > 0) {
      out.push({ role: "system-append", content: block.content, tag: "system-block" });
    }
  }

  return out;
}
