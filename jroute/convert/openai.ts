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
    // deeper insert is measured against.
    for (const inj of orderInjections(injections)) {
      const idx = Math.max(0, messages.length - inj.depth);
      messages.splice(idx, 0, { role: inj.role, content: inj.content });
    }

    const prefix: OpenAIMessage[] = systemBlocks.map((b) => ({
      role: "system",
      content: b.content,
    }));

    return { ...body, messages: [...prefix, ...messages] };
  },
};
