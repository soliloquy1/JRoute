import { mapFinishReason } from "./response.ts";

export interface GeminiStreamState {
  model: string;
  promptTokens: number;
  outputTokens: number;
  roleSent: boolean;
}

export function createGeminiStreamState(model: string): GeminiStreamState {
  return { model, promptTokens: 0, outputTokens: 0, roleSent: false };
}

export interface GeminiEventResult {
  chunks: Array<Record<string, unknown>>;
  terminate: boolean;
  upstreamError: string | null;
}

function baseChunk(
  state: GeminiStreamState,
  delta: Record<string, unknown>,
  finishReason: string | null = null
): Record<string, unknown> {
  return {
    id: "chatcmpl-stream",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: state.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { role?: string; parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Converts one Gemini SSE `data:` frame into zero or more OpenAI-shaped chunks, mutating
 * `state` (running token counts, whether the assistant role delta has been sent).
 *
 * Gemini's stream has NO `message_stop` and NO upstream `[DONE]` (Global Constraints, verified
 * fact #5): the terminal signal is a frame whose `candidates[0].finishReason` is set. On that
 * frame this emits the finish_reason chunk AND the usage chunk together (Gemini carries both on
 * the final frame, unlike Anthropic which splits them across message_delta/message_stop), and
 * sets `terminate: true`. A non-JSON frame fails LOUD (`terminate`, `upstreamError`) rather
 * than being silently dropped, since dropping a frame desyncs what the client already rendered.
 */
export function convertGeminiChunk(data: string, state: GeminiStreamState): GeminiEventResult {
  let parsed: GeminiStreamChunk;
  try {
    parsed = JSON.parse(data) as GeminiStreamChunk;
  } catch {
    return { chunks: [], terminate: true, upstreamError: "Malformed upstream frame" };
  }

  const candidate = parsed.candidates?.[0];
  const usage = parsed.usageMetadata;
  if (usage) {
    if (typeof usage.promptTokenCount === "number") state.promptTokens = usage.promptTokenCount;
    if (typeof usage.candidatesTokenCount === "number")
      state.outputTokens = usage.candidatesTokenCount;
  }

  const chunks: Array<Record<string, unknown>> = [];

  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (text.length > 0) {
    const delta: Record<string, unknown> = { content: text };
    if (!state.roleSent) {
      delta.role = "assistant";
      state.roleSent = true;
    }
    chunks.push(baseChunk(state, delta));
  }

  if (candidate?.finishReason) {
    // Terminal frame: emit finish_reason on its own chunk, then a usage-only chunk with empty
    // choices (mirrors the OpenAI streaming usage convention). Prompt tokens are
    // promptTokenCount alone — cached tokens are already inside it (verified fact #3).
    chunks.push(baseChunk(state, {}, mapFinishReason(candidate.finishReason)));
    chunks.push({
      id: "chatcmpl-stream",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model,
      choices: [],
      usage: {
        prompt_tokens: state.promptTokens,
        completion_tokens: state.outputTokens,
        total_tokens: state.promptTokens + state.outputTokens,
      },
    });
    return { chunks, terminate: true, upstreamError: null };
  }

  return { chunks, terminate: false, upstreamError: null };
}
