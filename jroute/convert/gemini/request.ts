import { orderInjections, partitionBlocks } from "../types.ts";
import type {
  ConvertRequestParams,
  OpenAIMessage,
  RequestConverter,
  TaggedBlock,
} from "../types.ts";

/** A Gemini content part. Plan 2c covers text only; inbound images and functionCall/
 * functionResponse parts arrive with their consumers in a later plan (design spec §2.2). */
export interface GeminiPart {
  text: string;
}

/** A Gemini `contents[]` entry. Role is `user` or `model` — there is no `system` role here
 * (system content lives in `systemInstruction`), and `assistant` maps to `model`. */
export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface OpenAITextPart {
  type: "text";
  text?: string;
}

/**
 * Normalizes OpenAI message content into Gemini text parts. Content may be a plain string
 * OR a block array (design spec §6.3 #2). Emitting parts uniformly (even for a plain string)
 * gives Task 2's injection placement one shape to work with. Non-text parts (e.g. images) are
 * dropped in this plan — text only.
 */
export function toGeminiParts(content: unknown): GeminiPart[] {
  if (content === null || content === undefined) return [];
  if (typeof content === "string") {
    return content.length > 0 ? [{ text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const out: GeminiPart[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part.length > 0) out.push({ text: part });
      continue;
    }
    if (typeof part !== "object" || part === null) continue;
    const typed = part as { type?: unknown };
    if (typed.type === "text") {
      const text = (part as OpenAITextPart).text;
      if (typeof text === "string" && text.length > 0) out.push({ text });
    }
  }
  return out;
}

function partsToText(content: unknown): string {
  if (typeof content === "string") return content;
  return toGeminiParts(content)
    .map((p) => p.text)
    .join("\n");
}

/**
 * Maps the OpenAI sampling params Gemini accepts into `generationConfig` with Gemini's field
 * names. Everything else is dropped — like Anthropic, Gemini rejects unknown params, so a
 * blanket passthrough of the client body would break on `frequency_penalty`, `n`, etc. This
 * is the one place in the pipeline where dropping fields is correct.
 */
function mapGenerationConfig(
  body: Record<string, unknown>,
  maxOutputTokens: number
): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  if (typeof body.temperature === "number") cfg.temperature = body.temperature;
  if (typeof body.top_p === "number") cfg.topP = body.top_p;
  if (typeof body.top_k === "number") cfg.topK = body.top_k;
  cfg.maxOutputTokens = maxOutputTokens;

  const stop = body.stop;
  if (typeof stop === "string") cfg.stopSequences = [stop];
  else if (Array.isArray(stop) && stop.every((s) => typeof s === "string"))
    cfg.stopSequences = stop;

  return cfg;
}

/**
 * Hoists system content into `systemInstruction` parts (design spec §6.2 native strategy):
 * tagged system-blocks first, then any client `role: "system"` message (which has nowhere
 * else to go — Gemini has no system role in `contents`). Depth-injections do NOT come through
 * here; Task 2 places them into the last user turn's parts.
 */
export function hoistedSystemParts(
  systemBlocks: TaggedBlock[],
  messages: OpenAIMessage[]
): GeminiPart[] {
  const parts: GeminiPart[] = [];
  for (const b of systemBlocks) {
    const text = partsToText(b.content);
    if (text.length > 0) parts.push({ text });
  }
  for (const m of messages) {
    if (m.role !== "system") continue;
    const text = partsToText(m.content);
    if (text.length > 0) parts.push({ text });
  }
  return parts;
}

/**
 * Places depth-injections into content PARTS (design spec §6.4 Gemini row), honouring depth.
 * Mirrors the Anthropic converter's `placeInjections` (Plan 2a) — Gemini has no
 * mid-conversation system turn either, so an injection becomes parts inside an existing user
 * turn. The two failure modes it avoids: teleport-to-top (handled by the tag split upstream)
 * and teleport-to-bottom (handled here by honouring `depth`).
 *
 * Model-turn redirect: an injection landing on a `model` turn moves to the nearest preceding
 * `user` turn — lorebook text inside a model turn makes the model believe it said those words.
 * With a leading greeting and alternating history this fires often, so it is a main path.
 */
export function placeGeminiInjections(
  contents: GeminiContent[],
  injections: Array<Extract<TaggedBlock, { tag: "depth-injection" }>>
): GeminiContent[] {
  if (injections.length === 0 || contents.length === 0) return contents;

  const out: GeminiContent[] = contents.map((c) => ({ ...c, parts: [...c.parts] }));

  for (const inj of orderInjections(injections)) {
    const targetIdx = Math.max(0, out.length - 1 - inj.depth);
    let idx = targetIdx;
    while (idx >= 0 && out[idx].role !== "user") idx -= 1;
    if (idx < 0) {
      idx = out.findIndex((c) => c.role === "user");
      if (idx < 0) idx = targetIdx;
    }
    out[idx].parts.push(...toGeminiParts(inj.content));
  }
  return out;
}

/**
 * Leading `model` greeting -> absorbed into systemInstruction (design spec §6.3 #4 analogue).
 * Every Janitor chat opens with the character's greeting; leaving it as a leading model turn
 * both wastes the slot and (for stricter models) can be rejected. Returns the absorbed text so
 * the caller appends it to `systemInstruction`. The greeting is character content, not noise —
 * absorbing it preserves the established voice rather than discarding it.
 */
export function absorbLeadingModel(contents: GeminiContent[]): {
  contents: GeminiContent[];
  absorbed: string[];
} {
  const absorbed: string[] = [];
  let i = 0;
  while (i < contents.length && contents[i].role === "model") {
    const text = contents[i].parts.map((p) => p.text).join("\n");
    if (text.length > 0) absorbed.push(text);
    i += 1;
  }
  return { contents: contents.slice(i), absorbed };
}

/** Strip empty-parts messages so no `{ role, parts: [] }` reaches Gemini. */
function stripEmptyContents(contents: GeminiContent[]): GeminiContent[] {
  return contents.filter((c) => c.parts.length > 0);
}

export const geminiConverter: RequestConverter = {
  convertRequest({ maxTokens, body, blocks }: ConvertRequestParams) {
    const { systemBlocks, injections } = partitionBlocks(blocks);
    const incoming = (body.messages as OpenAIMessage[]) ?? [];

    const systemParts = hoistedSystemParts(systemBlocks, incoming);

    let contents: GeminiContent[] = incoming
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: toGeminiParts(m.content),
      }));

    // Leading model greeting -> systemInstruction (runs before placement so depths measure
    // against the real conversation).
    const led = absorbLeadingModel(contents);
    contents = led.contents;
    for (const text of led.absorbed) systemParts.push({ text });

    // Depth-injections into the last user turn's parts, honouring depth.
    contents = placeGeminiInjections(contents, injections);

    // Strip empty content.
    contents = stripEmptyContents(contents);

    const requested = Number.isFinite(body.max_tokens) ? (body.max_tokens as number) : maxTokens;
    const maxOutputTokens = Math.max(1, Math.min(requested, maxTokens));

    const out: Record<string, unknown> = {
      contents,
      generationConfig: mapGenerationConfig(body, maxOutputTokens),
    };
    if (systemParts.length > 0) out.systemInstruction = { parts: systemParts };

    return out;
  },
};
