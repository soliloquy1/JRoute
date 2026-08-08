import { partitionBlocks, orderInjections } from "./types.ts";
import type { ConvertRequestParams, OpenAIMessage, RequestConverter } from "./types.ts";

/**
 * The identity converter, written explicitly rather than special-cased at the call site.
 *
 * OpenAI-shaped targets honour mid-conversation `role: "system"` turns, so a
 * depth-injection is rendered as a system message at its depth (product spec §6.4) —
 * unlike Anthropic, which has no such role and must embed injections in message content.
 */
export const openaiConverter: RequestConverter = {
  convertRequest({ body, blocks }: ConvertRequestParams): Record<string, unknown> {
    if (blocks.length === 0) return body;

    const { systemBlocks, injections } = partitionBlocks(blocks);
    const messages = [...((body.messages as OpenAIMessage[]) ?? [])];

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

    const prefix: OpenAIMessage[] = systemBlocks.map((b) => ({
      role: "system",
      content: b.content,
    }));

    return { ...body, messages: [...prefix, ...messages] };
  },
};
