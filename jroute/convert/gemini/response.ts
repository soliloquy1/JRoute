// jroute/convert/gemini/response.ts

/** Fields this converter reads from a non-streaming Gemini generateContent response.
 * https://ai.google.dev/api/generate-content — the shape is a superset; only consumed
 * fields are declared. */
export interface GeminiResponseJson {
  candidates?: Array<{
    content?: { role?: string; parts?: Array<{ text?: string }> };
    finishReason?: string;
    index?: number;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

/**
 * Gemini `finishReason` -> OpenAI `finish_reason` (Global Constraints, verified fact #4, full
 * table). Every safety/recitation/blocklist/SPII/image-safety/language variant maps to
 * `content_filter` — a partial table that only knows STOP/MAX_TOKENS/SAFETY silently mislabels
 * those as `stop`, hiding a filter cut-off from the operator. Unknown values degrade to `stop`
 * rather than throwing.
 */
const FINISH_REASON_MAP: Record<string, string> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
  BLOCKLIST: "content_filter",
  PROHIBITED_CONTENT: "content_filter",
  SPII: "content_filter",
  IMAGE_SAFETY: "content_filter",
  LANGUAGE: "content_filter",
  MALFORMED_FUNCTION_CALL: "stop", // an error, but not a filter; tool_calls arrives with MCP
  OTHER: "stop",
  FINISH_REASON_UNSPECIFIED: "stop",
};

export function mapFinishReason(reason: string | null | undefined): string {
  if (!reason) return "stop";
  return FINISH_REASON_MAP[reason] ?? "stop";
}

/**
 * Prompt tokens = `promptTokenCount` ALONE. Gemini's `promptTokenCount` is the total effective
 * prompt size and ALREADY INCLUDES `cachedContentTokenCount` (Global Constraints, verified fact
 * #3). Adding the cached field double-counts. This is the inverse of the Anthropic converter,
 * where the (separate) cache fields MUST be summed — do not copy that logic here.
 */
function promptTokensFrom(usage: GeminiResponseJson["usageMetadata"]): number {
  return usage?.promptTokenCount ?? 0;
}

export function convertResponse(
  json: GeminiResponseJson,
  requestedModel: string
): Record<string, unknown> {
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");

  const promptTokens = promptTokensFrom(json.usageMetadata);
  const completionTokens = json.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: mapFinishReason(candidate?.finishReason),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}
