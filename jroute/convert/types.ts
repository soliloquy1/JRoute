// jroute/convert/types.ts

/**
 * Every block the prompt stage produces carries a tag, and the tag — never the role —
 * decides whether it may be hoisted (product spec §6.4).
 *
 * This is a DISCRIMINATED UNION on purpose. An interface with `depth?: number` and a
 * comment saying "required for depth-injection" compiles for a depth-injection with no
 * depth; an implementer then writes `block.depth ?? 0` and every injection collapses to
 * depth 0, silently deleting the feature. The union makes that uncompilable.
 *
 * NOTE ON WHAT THE TAG DOES AND DOES NOT GUARANTEE (design spec §1.1): the tag prevents
 * "teleport to the top" (hoisting keyed off role). It does NOT prevent "teleport to the
 * bottom" — an implementation can honour every tag, hoist nothing, and still append all
 * injections to the last message. The positional assertion in the tests is the guard for
 * that second failure, and it is not optional.
 */
export type TaggedBlock =
  | { role: string; content: unknown; tag: "system-block" }
  | { role: string; content: unknown; tag: "depth-injection"; depth: number };

export interface ConvertRequestParams {
  /** The resolved model id, as the upstream expects to receive it. */
  model: string;
  /** Per-model output ceiling from MODEL_MAP. */
  maxTokens: number;
  /** The validated OpenAI-shaped request body from the client. */
  body: Record<string, unknown>;
  /** Tagged blocks from the prompt stage. Plan 2 populates only `system-block`. */
  blocks: TaggedBlock[];
}

export interface RequestConverter {
  convertRequest(p: ConvertRequestParams): Record<string, unknown>;
}

/** An OpenAI-shaped chat message, as it arrives from the client. */
export interface OpenAIMessage {
  role: string;
  content?: unknown;
  [k: string]: unknown;
}

/**
 * Splits blocks by tag. Returned separately because the two halves have entirely
 * different destinations in every target format.
 */
export function partitionBlocks(blocks: TaggedBlock[]): {
  systemBlocks: TaggedBlock[];
  injections: Array<Extract<TaggedBlock, { tag: "depth-injection" }>>;
} {
  const systemBlocks: TaggedBlock[] = [];
  const injections: Array<Extract<TaggedBlock, { tag: "depth-injection" }>> = [];
  for (const b of blocks) {
    if (b.tag === "depth-injection") injections.push(b);
    else systemBlocks.push(b);
  }
  return { systemBlocks, injections };
}

/**
 * Product spec §6.3 #9: deeper depth first, then registration order within a depth.
 * `sort` is stable in ES2019+, so equal depths keep their original relative order.
 */
export function orderInjections(
  injections: Array<Extract<TaggedBlock, { tag: "depth-injection" }>>
): Array<Extract<TaggedBlock, { tag: "depth-injection" }>> {
  return [...injections].sort((a, b) => b.depth - a.depth);
}
