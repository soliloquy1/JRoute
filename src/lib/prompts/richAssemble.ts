// src/lib/prompts/richAssemble.ts
import { runLorebooksForRequest } from "../lorebooks/runner.ts";
import { substituteMacros } from "./macros.ts";
import type { RichPreset } from "../db/types.ts";
import type { RichPresetJson, RichPromptEntry } from "./stPresetSchema.ts";
import type { TaggedBlock } from "../../../jroute/convert/types.ts";

const CHAR_MARKERS_ALWAYS_EMPTY = new Set([
  "charPersonality",
  "scenario",
  "personaDescription",
  "dialogueExamples",
]);

const SAMPLER_FIELDS = [
  "temperature",
  "top_p",
  "top_k",
  "top_a",
  "min_p",
  "repetition_penalty",
  "frequency_penalty",
  "presence_penalty",
  "n",
] as const;

/**
 * A negative seed is SillyTavern's own "no seed" convention (design spec §7.1) — dropped
 * rather than forwarded as -1, which most upstream APIs would reject or misinterpret.
 */
export function extractSamplerParams(raw: RichPresetJson): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of SAMPLER_FIELDS) {
    const v = raw[field];
    if (typeof v === "number") out[field] = v;
  }
  if (typeof raw.seed === "number" && raw.seed >= 0) out.seed = raw.seed;
  return out;
}

function orderedEnabledEntries(raw: RichPresetJson): RichPromptEntry[] {
  const promptsById = new Map(raw.prompts.map((p) => [p.identifier, p]));
  const orderEntry = raw.prompt_order[0];
  const out: RichPromptEntry[] = [];
  for (const o of orderEntry.order) {
    if (!o.enabled) continue;
    const entry = promptsById.get(o.identifier);
    if (entry) out.push(entry);
  }
  return out;
}

interface PendingDepthInjection {
  depth: number;
  order: number;
  block: TaggedBlock;
}

/**
 * `injection_order` has no equivalent in the frozen `orderInjections` (depth-only stable
 * sort, design spec §7.3) — so entries sharing a depth are pre-sorted here, by
 * `injection_order` descending (matching SillyTavern's own tie-break), before being placed
 * into the array `orderInjections` will later stable-sort purely by depth. The stable sort
 * preserves this relative order as a side effect of registration order.
 */
function finalizePendingInjections(pending: PendingDepthInjection[]): TaggedBlock[] {
  const byDepth = new Map<number, PendingDepthInjection[]>();
  for (const p of pending) {
    const list = byDepth.get(p.depth) ?? [];
    list.push(p);
    byDepth.set(p.depth, list);
  }
  const out: TaggedBlock[] = [];
  for (const list of byDepth.values()) {
    list.sort((a, b) => b.order - a.order);
    out.push(...list.map((p) => p.block));
  }
  return out;
}

export interface AssembleRichPresetInput {
  preset: RichPreset;
  messages: Array<{ role: string; content: unknown }>;
  rawSystemPrompt: string;
}

export interface AssembleRichPresetOutput {
  blocks: TaggedBlock[];
  samplerParams: Record<string, unknown>;
}

export function assembleRichPreset(input: AssembleRichPresetInput): AssembleRichPresetOutput {
  const { preset, messages, rawSystemPrompt } = input;
  const raw = preset.raw;
  const entries = orderedEnabledEntries(raw);
  const macroCtx = { char: preset.charName, user: preset.userName };

  // No chatHistory marker present -> everything is prepend (design spec §7.2): there is
  // no anchor to split on, so nothing has a defensible reason to land after the history.
  const chatHistoryIndex = entries.findIndex((e) => e.identifier === "chatHistory");

  let lorebookBlocksCache: TaggedBlock[] | null = null;
  function lorebookBlocksOnce(): TaggedBlock[] {
    if (lorebookBlocksCache === null) {
      lorebookBlocksCache =
        preset.lorebookIds.length > 0
          ? runLorebooksForRequest({ lorebookIds: preset.lorebookIds, messages, rawSystemPrompt })
          : [];
    }
    return lorebookBlocksCache;
  }

  const prepend: TaggedBlock[] = [];
  const append: TaggedBlock[] = [];
  const pendingInjections: PendingDepthInjection[] = [];
  let worldInfoBlocksAdded = false;

  entries.forEach((entry, index) => {
    if (entry.identifier === "chatHistory") return;

    if (entry.identifier === "worldInfoBefore" || entry.identifier === "worldInfoAfter") {
      if (!worldInfoBlocksAdded) {
        for (const block of lorebookBlocksOnce()) {
          if (block.tag === "depth-injection") {
            pendingInjections.push({ depth: block.depth, order: 0, block });
          }
        }
        worldInfoBlocksAdded = true;
      }
      return;
    }

    let text: string | null;
    if (entry.identifier === "charDescription") {
      text = rawSystemPrompt.length > 0 ? rawSystemPrompt : null;
    } else if (CHAR_MARKERS_ALWAYS_EMPTY.has(entry.identifier)) {
      text = null;
    } else {
      text = typeof entry.content === "string" && entry.content.length > 0 ? entry.content : null;
    }

    if (text === null) return;
    text = substituteMacros(text, macroCtx);

    if (entry.injection_position === 1) {
      const depth = entry.injection_depth ?? 0;
      pendingInjections.push({
        depth,
        order: entry.injection_order ?? 100,
        block: { role: entry.role, content: text, tag: "depth-injection", depth },
      });
      return;
    }

    const isBeforeHistory = chatHistoryIndex === -1 || index < chatHistoryIndex;
    const block: TaggedBlock = {
      role: isBeforeHistory ? "system-prepend" : "system-append",
      content: text,
      tag: "system-block",
    };
    (isBeforeHistory ? prepend : append).push(block);
  });

  return {
    blocks: [...prepend, ...finalizePendingInjections(pendingInjections), ...append],
    samplerParams: extractSamplerParams(raw),
  };
}
