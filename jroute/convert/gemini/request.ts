import { partitionBlocks } from "../types.ts";
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

export const geminiConverter: RequestConverter = {
  convertRequest({ maxTokens, body, blocks }: ConvertRequestParams) {
    const { systemBlocks } = partitionBlocks(blocks);
    const incoming = (body.messages as OpenAIMessage[]) ?? [];

    const systemParts = hoistedSystemParts(systemBlocks, incoming);

    const contents: GeminiContent[] = incoming
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: toGeminiParts(m.content),
      }));

    // Gemini REQUIRES max_output_tokens implicitly via generationConfig here; honour a smaller
    // client value, clamp anything above the model ceiling.
    const requested = Number.isFinite(body.max_tokens) ? (body.max_tokens as number) : maxTokens;
    const maxOutputTokens = Math.max(1, Math.min(requested, maxTokens));

    // NB: the resolved model id and the stream flag are URL concerns (Task 6 builds the path);
    // neither belongs in this body.
    const out: Record<string, unknown> = {
      contents,
      generationConfig: mapGenerationConfig(body, maxOutputTokens),
    };
    if (systemParts.length > 0) out.systemInstruction = { parts: systemParts };

    return out;
  },
};
