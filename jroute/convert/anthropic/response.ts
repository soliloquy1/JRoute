/**
 * The fields this converter reads from a non-streaming Anthropic Messages API response.
 * https://docs.claude.com/en/api/messages — the shape is a superset of this; only the
 * fields the converter actually consumes are declared.
 */
export interface AnthropicResponseJson {
  id?: string;
  content?: Array<{ type: string; text?: string }>;
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
  tool_use: "tool_calls", // unreachable until Plan 6 (no tool support yet)
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
  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  const promptTokens = promptTokensFrom(json.usage);
  const completionTokens = json.usage?.output_tokens ?? 0;

  return {
    id: json.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
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
