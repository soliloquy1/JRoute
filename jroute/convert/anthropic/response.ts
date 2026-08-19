/**
 * The fields this converter reads from a non-streaming Anthropic Messages API response.
 * https://docs.claude.com/en/api/messages — the shape is a superset of this; only the
 * fields the converter actually consumes are declared.
 */
export interface AnthropicResponseJson {
  id?: string;
  content?: Array<
    | { type: string; text?: string }
    | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  >;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Anthropic `stop_reason` -> OpenAI `finish_reason` (design spec §8.2, full table).
 *
 * `refusal` arrives as HTTP 200 with EMPTY content — it must map to `content_filter` here,
 * not be treated as a failure; a refusal is a successful request whose model declined to
 * answer, not a transport error. Anything unrecognized falls back to `"stop"` rather than
 * throwing: an unmapped stop_reason should degrade gracefully.
 */
const STOP_REASON_MAP: Record<string, string> = {
  end_turn: "stop",
  max_tokens: "length",
  stop_sequence: "stop",
  tool_use: "tool_calls", // native MCP tool-calling mode (design spec §7) — reachable now
  pause_turn: "stop",
  refusal: "content_filter",
};

export function mapStopReason(stopReason: string | null | undefined): string {
  if (!stopReason) return "stop";
  return STOP_REASON_MAP[stopReason] ?? "stop";
}

/**
 * Sums prompt-side usage across all three fields Anthropic reports separately.
 *
 * `cache_read_input_tokens` and `cache_creation_input_tokens` are NOT included in
 * `input_tokens` (design spec §8.1) — omitting them silently undercounts every cached
 * request.
 */
function promptTokensFrom(usage: AnthropicResponseJson["usage"]): number {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

/** Converts a non-streaming Anthropic Messages response into an OpenAI chat.completion body. */
export function convertResponse(
  json: AnthropicResponseJson,
  requestedModel: string
): Record<string, unknown> {
  const blocks = json.content ?? [];
  const text = blocks
    .filter((b): b is { type: "text"; text?: string } => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  // Native MCP mode (design spec §8.1): `content` may carry `tool_use` blocks. The pre-existing
  // `tool_use: "tool_calls"` stop-reason map entry now gets exercised whenever Anthropic returns
  // a tool invocation.
  const toolUseBlocks = blocks.filter(
    (b): b is { type: "tool_use"; id?: string; name?: string; input?: unknown } =>
      b.type === "tool_use"
  );

  const promptTokens = promptTokensFrom(json.usage);
  const completionTokens = json.usage?.output_tokens ?? 0;

  const message: Record<string, unknown> = {
    role: "assistant",
    // A tool-only response has no conversational text — OpenAI uses `content: null` in that
    // case. When text IS present alongside tool_use, keep it (the model may narrate + call).
    content: toolUseBlocks.length > 0 && text.length === 0 ? null : text,
  };
  if (toolUseBlocks.length > 0) {
    message.tool_calls = toolUseBlocks.map((b) => ({
      id: b.id ?? `toolu_${Date.now()}`,
      type: "function",
      function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
    }));
  }

  return {
    id: json.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapStopReason(json.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}
