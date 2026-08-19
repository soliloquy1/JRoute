import { orderInjections, partitionBlocks } from "../types.ts";
import type {
  ConvertRequestParams,
  OpenAIMessage,
  RequestConverter,
  TaggedBlock,
} from "../types.ts";

/**
 * Anthropic content blocks. Plan 2a covers text and image only; `tool_use` /
 * `tool_result` arrive in Plan 6 when MCP gives them a consumer, and thinking blocks are
 * unscheduled (design spec §2.2).
 */
export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "image"; source: { type: "url"; url: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface OpenAIImagePart {
  type: "image_url";
  image_url?: { url?: string };
}

interface OpenAITextPart {
  type: "text";
  text?: string;
}

/** `data:<media_type>;base64,<data>` — Anthropic wants the three parts separated. */
const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

function imagePartToBlock(part: OpenAIImagePart): AnthropicContentBlock | null {
  const url = part.image_url?.url;
  if (typeof url !== "string" || url.length === 0) return null;

  const m = DATA_URL.exec(url);
  if (m) {
    return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  }
  return { type: "image", source: { type: "url", url } };
}

/**
 * Normalizes OpenAI message content into Anthropic content blocks.
 *
 * Product spec §6.3 #2: content may be a string OR a block array, and a merge must append
 * a block rather than string-concatenating — string-concatenating a block array corrupts
 * the payload. Emitting blocks uniformly (even for a plain string) means every later
 * step, including injection placement in Task 7, has one shape to work with.
 */
export function toContentBlocks(content: unknown): AnthropicContentBlock[] {
  if (content === null || content === undefined) return [];

  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }

  if (!Array.isArray(content)) return [];

  const out: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part.length > 0) out.push({ type: "text", text: part });
      continue;
    }
    if (typeof part !== "object" || part === null) continue;

    const typed = part as { type?: unknown };
    if (typed.type === "text") {
      const text = (part as OpenAITextPart).text;
      if (typeof text === "string" && text.length > 0) out.push({ type: "text", text });
      continue;
    }
    if (typed.type === "image_url") {
      const block = imagePartToBlock(part as OpenAIImagePart);
      if (block) out.push(block);
      continue;
    }
    // Already an Anthropic-shaped block (e.g. re-sent history): pass it through.
    if (typed.type === "image") {
      out.push(part as AnthropicContentBlock);
    }
  }
  return out;
}

function blockToText(content: unknown): string {
  if (typeof content === "string") return content;
  return toContentBlocks(content)
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Fields Anthropic accepts that map cleanly from the OpenAI request. Everything else is
 * dropped rather than forwarded: Anthropic 400s on unknown top-level parameters, so a
 * blanket passthrough of the client body would break on `frequency_penalty`,
 * `presence_penalty`, `logit_bias`, `n`, and friends that Janitor and its presets emit.
 *
 * This is the one place in the pipeline where dropping fields is correct. Everywhere else
 * (Plan 1 handoff contract #2) the rule is the opposite — preserve unknown keys.
 */
function mapSamplingParams(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (typeof body.top_p === "number") out.top_p = body.top_p;
  if (typeof body.top_k === "number") out.top_k = body.top_k;

  const stop = body.stop;
  if (typeof stop === "string") out.stop_sequences = [stop];
  else if (Array.isArray(stop) && stop.every((s) => typeof s === "string")) {
    out.stop_sequences = stop;
  }
  return out;
}

export interface AnthropicMessage {
  role: string;
  content: AnthropicContentBlock[];
}

/**
 * Native MCP tool-calling mode (design spec §6, §6.1). Field names verified against the
 * current Anthropic Messages API: tool definitions use `{name, description, input_schema}`
 * (input_schema, NOT parameters), and an assistant tool invocation is a content block
 * `{type: "tool_use", id, name, input}` where `input` is an already-parsed object — NOT a
 * JSON string the way OpenAI's `tool_calls[].function.arguments` arrives.
 */
export type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: unknown;
};

/** OpenAI-style `tools: [{type:"function", function:{name, description, parameters}}]`. */
interface OpenAiToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

/** Maps the OpenAI tool list to Anthropic's `{name, description, input_schema}` shape. */
export function mapAnthropicTools(tools: unknown): AnthropicToolDef[] {
  if (!Array.isArray(tools)) return [];
  const out: AnthropicToolDef[] = [];
  for (const tool of tools) {
    if (typeof tool !== "object" || tool === null) continue;
    const fn = (tool as { function?: unknown }).function;
    if (typeof fn !== "object" || fn === null) continue;
    const f = fn as { name?: unknown; description?: unknown; parameters?: unknown };
    if (typeof f.name !== "string") continue;
    out.push({
      name: f.name,
      description: typeof f.description === "string" ? f.description : "",
      input_schema: f.parameters ?? { type: "object", properties: {} },
    });
  }
  return out;
}

/**
 * Maps OpenAI history to Anthropic messages, including the native-mode additions
 * (design spec §6): assistant `tool_calls` become `tool_use` content blocks, and a run of
 * consecutive `role:"tool"` messages (each a `tool_result`) collapse into ONE Anthropic
 * `user` message. This is NOT optional — emitting one user message per tool result produces
 * "tool_use ids were found without tool_result blocks immediately after", a hard 400.
 *
 * Two real constraints shape this:
 *   1. Anthropic requires every `tool_use` to be answered by a `tool_result` in the same
 *      conversation, so the merge must flush ONLY when the next message is NOT a tool result.
 *   2. `tool_result` blocks must lead the content array (Anthropic 400s on text-before-result
 *      ordering), so the merged user message carries nothing but the result blocks.
 */
export function mapMessagesToAnthropic(messages: OpenAIMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "tool") {
      // Buffer tool results and flush them as a single merged user message when the run ends.
      const last = out[out.length - 1];
      const result = {
        type: "tool_result" as const,
        tool_use_id: String(m.tool_call_id ?? ""),
        content: typeof m.content === "string" ? m.content : blockToText(m.content),
      };
      if (last && last.role === "user" && last.content.length > 0) {
        // Already mid-merge of a tool run — append to the same user message.
        last.content.push(result);
      } else {
        out.push({ role: "user", content: [result] });
      }
      continue;
    }

    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const content: AnthropicContentBlock[] = [];
      const text = blockToText(m.content);
      if (text.length > 0) content.push({ type: "text", text });
      for (const call of m.tool_calls) {
        const fn = (call as { function?: unknown }).function;
        const name =
          call.name ??
          (typeof fn === "object" && fn !== null ? (fn as { name?: unknown }).name : undefined);
        let input: unknown = {};
        if (typeof call.arguments === "string") {
          try {
            input = JSON.parse(call.arguments);
          } catch {
            input = {};
          }
        } else if (fn && typeof fn === "object" && "arguments" in fn) {
          const fa = (fn as { arguments?: unknown }).arguments;
          if (typeof fa === "string") {
            try {
              input = JSON.parse(fa);
            } catch {
              input = {};
            }
          } else if (fa && typeof fa === "object") {
            input = fa;
          }
        }
        content.push({
          type: "tool_use",
          id: String(call.id ?? ""),
          name: typeof name === "string" ? name : "",
          input,
        });
      }
      out.push({ role: "assistant", content });
      continue;
    }

    out.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: toContentBlocks(m.content),
    });
  }

  return out;
}

/**
 * Places depth-injections into message CONTENT (design spec §6.5).
 *
 * Anthropic has no mid-conversation system role — verified: "there is no `system` role for
 * input messages in the Messages API" — so an injection cannot be a message of its own the
 * way it can on OpenAI-shaped targets. It becomes content inside an existing message.
 *
 * Two failure modes this function must avoid, per design spec §1.1:
 *   1. Hoisting it into `system` (teleport to top) — handled by the tag split upstream.
 *   2. Appending everything to the last message (teleport to bottom) — handled HERE by
 *      honouring `depth`. Product spec §6.4's wording ("appended into the last user
 *      message content, at depth position") names two destinations; the second is correct.
 *
 * Assistant-turn redirect: if the message at `depth` is an assistant turn, the injection
 * moves to the nearest PRECEDING user turn. Putting lorebook text inside an assistant turn
 * makes the model believe it said those words. With a leading greeting and alternating
 * history this fires on roughly half of all depths, so it is a main path, not an edge.
 */
export function placeInjections(
  messages: AnthropicMessage[],
  injections: Array<Extract<TaggedBlock, { tag: "depth-injection" }>>
): AnthropicMessage[] {
  if (injections.length === 0 || messages.length === 0) return messages;

  // Clone so the caller's array (and each content array) is never mutated.
  const out: AnthropicMessage[] = messages.map((m) => ({ ...m, content: [...m.content] }));

  for (const inj of orderInjections(injections)) {
    // depth 0 == the final message; depth N == N messages from the end. Clamp to the top
    // of the history when depth exceeds the conversation (product spec §6.3 #8).
    const targetIdx = Math.max(0, out.length - 1 - inj.depth);

    // Redirect off an assistant turn onto the nearest preceding user turn. If there is
    // none (the conversation opens with the character's greeting), fall forward to the
    // first user turn rather than giving up and using the assistant one.
    let idx = targetIdx;
    while (idx >= 0 && out[idx].role !== "user") idx -= 1;
    if (idx < 0) {
      idx = out.findIndex((m) => m.role === "user");
      if (idx < 0) idx = targetIdx; // No user turn at all — nothing better available.
    }

    out[idx].content.push(...toContentBlocks(inj.content));
  }

  return out;
}

/**
 * Product spec §6.3 #4. Anthropic requires the conversation to begin with a user turn,
 * and after system hoisting `messages[0]` is the character's greeting — which is how
 * EVERY Janitor chat opens. This therefore fires on essentially all real traffic.
 *
 * The greeting is character content, not noise, so it is absorbed into the system blocks
 * rather than discarded: dropping it silently would change the character's established
 * voice. Returns the absorbed text so the caller can append it to `system`.
 */
function absorbLeadingAssistant(messages: AnthropicMessage[]): {
  messages: AnthropicMessage[];
  absorbed: string[];
} {
  const absorbed: string[] = [];
  let i = 0;
  while (i < messages.length && messages[i].role === "assistant") {
    const text = messages[i].content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (text.length > 0) absorbed.push(text);
    i += 1;
  }
  return { messages: messages.slice(i), absorbed };
}

/**
 * Product spec §6.3 #7, CORRECTED (design spec §12.1).
 *
 * The product spec says a trailing assistant turn "must survive conversion". That is no
 * longer true: Claude 4.6+ returns 400 invalid_request_error — "This model does not
 * support assistant message prefill. The conversation must end with a user message." —
 * and claude-sonnet-4-6 is this plan's reference model. Preserving the prefill would ship
 * a guaranteed 400 on every request that carries one.
 *
 * Trailing assistant content is dropped. It is not absorbed into `system`: a prefill is an
 * instruction about how to START the reply, and relocating it to the system prompt changes
 * its meaning rather than preserving it.
 */
function dropTrailingAssistant(messages: AnthropicMessage[]): AnthropicMessage[] {
  let end = messages.length;
  while (end > 0 && messages[end - 1].role === "assistant") end -= 1;
  return messages.slice(0, end);
}

/** Product spec §6.3 #6: Anthropic 400s on empty content — drop the message entirely. */
function stripEmpty(messages: AnthropicMessage[]): AnthropicMessage[] {
  return messages.filter((m) => m.content.length > 0);
}

function hoistedSystem(
  systemBlocks: TaggedBlock[],
  messages: OpenAIMessage[]
): Array<{ type: "text"; text: string }> {
  const parts: Array<{ type: "text"; text: string }> = [];
  const appendBlocks: TaggedBlock[] = [];

  // Prepend-position blocks (any role other than "system-append", including plain
  // "system" for backward compatibility) come first — before Janitor's own card.
  for (const b of systemBlocks) {
    if (b.role === "system-append") {
      appendBlocks.push(b);
      continue;
    }
    const text = blockToText(b.content);
    if (text.length > 0) parts.push({ type: "text", text });
  }

  // A client-supplied role:system message has nowhere else to go — Anthropic has no
  // system role inside `messages`. It is a system-block by nature, so it hoists.
  // Depth-injections do NOT come through here; Task 7 places them in message content.
  for (const m of messages) {
    if (m.role !== "system") continue;
    const text = blockToText(m.content);
    if (text.length > 0) parts.push({ type: "text", text });
  }

  // §6.1: append-position blocks are the last thing in the prompt.
  for (const b of appendBlocks) {
    const text = blockToText(b.content);
    if (text.length > 0) parts.push({ type: "text", text });
  }

  return parts;
}

export const anthropicConverter: RequestConverter = {
  convertRequest({ model, maxTokens, body, blocks }: ConvertRequestParams) {
    const { systemBlocks, injections } = partitionBlocks(blocks);
    const incoming = (body.messages as OpenAIMessage[]) ?? [];

    // 1. Hoist system content (tagged blocks + any client role:system message).
    const system = hoistedSystem(systemBlocks, incoming);

    // Map to Anthropic shape, dropping the system messages already hoisted in step 1.
    // Native mode uses mapMessagesToAnthropic so assistant tool_calls and tool results are
    // preserved (design spec §6); the plain map above is a non-native fallback path.
    const tools = Array.isArray(body.tools) ? mapAnthropicTools(body.tools) : null;
    let messages: AnthropicMessage[] = mapMessagesToAnthropic(
      incoming.filter((m) => m.role !== "system")
    );

    // 2. Leading assistant greeting -> absorbed into system (§6.3 #4).
    const led = absorbLeadingAssistant(messages);
    messages = led.messages;
    for (const text of led.absorbed) system.push({ type: "text", text });

    // 3. Depth-injections into message content (§6.5, §6.3 #8/#9). Runs AFTER the
    //    leading-assistant drop so depths are measured against the real conversation.
    messages = placeInjections(messages, injections);

    // 4. Strip empty content (§6.3 #6).
    messages = stripEmpty(messages);

    // 5. Trailing assistant prefill -> dropped (§6.3 #7, corrected — 400 on Claude 4.6+).
    //    Runs after placement so an injection targeting the final turn is not stranded on
    //    a message that is about to be removed.
    messages = dropTrailingAssistant(messages);

    // Anthropic REQUIRES max_tokens; OpenAI treats it as optional and Janitor never sends
    // it. Honour a smaller client value, clamp anything above the model ceiling — going
    // over is a 400 in the other direction.
    const requested = Number.isFinite(body.max_tokens) ? (body.max_tokens as number) : maxTokens;
    const max_tokens = Math.max(1, Math.min(requested, maxTokens));

    const out: Record<string, unknown> = {
      model,
      messages,
      max_tokens,
      ...mapSamplingParams(body),
    };
    // Native MCP tool-calling mode (design spec §6, §6.1): when the operator enabled MCP
    // tools, advertise them and ALWAYS force tool_choice to "auto" so the model may use them
    // or not — a client-supplied tool_choice (e.g. "none") must be ignored, never forwarded.
    if (tools && tools.length > 0) {
      out.tools = tools;
      out.tool_choice = { type: "auto" };
    }
    if (system.length > 0) out.system = system;
    if (body.stream === true) out.stream = true;

    return out;
  },
};
