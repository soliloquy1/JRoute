import { partitionBlocks, orderInjections } from "./types.ts";
import type {
  ConvertRequestParams,
  OpenAIMessage,
  RequestConverter,
  TaggedBlock,
} from "./types.ts";

const MERGE_SEPARATOR = "\n\n";

/**
 * The identity converter, written explicitly rather than special-cased at the call site.
 *
 * OpenAI-shaped targets honour mid-conversation `role: "system"` turns, so a
 * depth-injection is rendered as a system message at its depth (product spec §6.4) —
 * unlike Anthropic/Gemini, which have no such role and must embed injections in message
 * content.
 *
 * `system-block` content is split by the `role` convention Task 1 of this plan produces:
 * `"system-prepend"` merges into (or inserts as) the leading system turn — the OpenAI-
 * shaped default per §6.2's table. `"system-append"` becomes a brand-new trailing system
 * message, placed after the whole conversation including depth-injections, matching §6.1's
 * literal `[... last user message] [append block]` ordering. Any other role value (e.g.
 * plain `"system"`, used by pre-Plan-4 tests and Janitor's own hoisting elsewhere) is
 * treated as prepend-position for backward compatibility.
 */
function mergeText(existing: unknown, addition: string): unknown {
  if (Array.isArray(existing)) {
    return [...existing, { type: "text", text: addition }];
  }
  if (typeof existing === "string" && existing.length > 0) {
    return `${existing}${MERGE_SEPARATOR}${addition}`;
  }
  return addition;
}

function applyPrependBlocks(messages: OpenAIMessage[], prependText: string): OpenAIMessage[] {
  if (prependText.length === 0) return messages;

  const out = [...messages];
  if (out.length > 0 && out[0].role === "system") {
    out[0] = { ...out[0], content: mergeText(out[0].content, prependText) };
    return out;
  }
  // §6.3 #1: never concatenate into a user turn, never search forward for a later
  // system message — insert a new one at index 0.
  return [{ role: "system", content: prependText }, ...out];
}

export const openaiConverter: RequestConverter = {
  convertRequest({ model, body, blocks }: ConvertRequestParams): Record<string, unknown> {
    // `model` is the resolved native id (prefix stripped); always send that upstream,
    // never the client's possibly-prefixed id that lives on body.model.
    if (blocks.length === 0) return { ...body, model };

    const { systemBlocks, injections } = partitionBlocks(blocks);
    const prependParts: string[] = [];
    const appendParts: string[] = [];
    for (const b of systemBlocks) {
      const text = typeof b.content === "string" ? b.content : "";
      if (text.length === 0) continue;
      if (b.role === "system-append") appendParts.push(text);
      else prependParts.push(text);
    }

    let messages: OpenAIMessage[] = applyPrependBlocks(
      [...((body.messages as OpenAIMessage[]) ?? [])],
      prependParts.join(MERGE_SEPARATOR)
    );

    // Deeper depths first: inserting a shallower one first would shift the indices the
    // deeper insert is measured against. The base index is computed against the
    // ORIGINAL (pre-splice) length, not the live `messages.length` — the array grows on
    // every iteration, and reading its live length would make each subsequent (shallower)
    // insertion drift forward past insertions already made this loop, inverting the
    // deeper-first order. `inserted` corrects for that: injections are processed in
    // ascending target-index order, so every prior insertion this loop landed at or
    // before the current target and must be counted.
    const originalLength = messages.length;
    let inserted = 0;
    for (const inj of orderInjections(injections)) {
      const idx = Math.max(0, originalLength - inj.depth) + inserted;
      messages.splice(idx, 0, { role: inj.role, content: inj.content });
      inserted++;
    }

    // §6.1: the append block is the LAST thing in the prompt — after the last user
    // message and after any depth-injection, which (with lorebooks not yet built) is the
    // tail of `messages` at this point.
    if (appendParts.length > 0) {
      messages = [...messages, { role: "system", content: appendParts.join(MERGE_SEPARATOR) }];
    }

    return { ...body, model, messages };
  },
};
