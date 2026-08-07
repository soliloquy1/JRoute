import { mapFinishReason } from "./response.ts";
import { parseSseFrames } from "../anthropic/stream.ts";
import { errorEventBytes } from "../../sse.ts";
import { sanitizeErrorMessage } from "../../errors.ts";

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

export interface GeminiStreamCompletion {
  promptTokens: number | null;
  outputTokens: number | null;
  reason: "completed" | "upstream-closed" | "client-hangup";
}

export interface GeminiStreamOptions {
  model: string;
  onComplete: (result: GeminiStreamCompletion) => void;
}

/**
 * Wraps the pure `parseSseFrames`/`convertGeminiChunk` functions in a never-throw
 * TransformStream (design spec §8.4). Gemini has no `message_stop` and no upstream `[DONE]`:
 * natural completion is the pure converter returning `terminate: true` (a finishReason frame),
 * at which point WE synthesize the `[DONE]` sentinel and report `reason: "completed"`. A source
 * that closes without any finishReason is a truncated connection (`flush` -> "upstream-closed").
 * A consumer cancelling mid-stream is a post-dial client hangup (`cancel` -> "client-hangup").
 *
 * The never-throw / onComplete-once / flush / cancel scaffold is DELIBERATELY duplicated from
 * `createAnthropicStreamTransform` (jroute/convert/anthropic/stream.ts). Extracting a shared
 * helper would refactor shipped, reviewed Anthropic code and force its re-review — not worth it
 * for one converter. The `terminated` flag guarantees `onComplete` fires exactly once.
 *
 * `cancel` on Transformer is a WHATWG Streams spec addition not yet in this TS version's
 * lib.dom.d.ts; the intersection type declares it without an `any` cast. Node 22+ wires it up.
 */
export function createGeminiStreamTransform(
  options: GeminiStreamOptions
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = createGeminiStreamState(options.model);
  let buffer = "";
  let terminated = false;

  const transformer: Transformer<Uint8Array, Uint8Array> & { cancel?: () => void } = {
    transform(chunk, controller) {
      if (terminated) return;
      try {
        buffer += decoder.decode(chunk, { stream: true });
        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;

        for (const frame of frames) {
          const result = convertGeminiChunk(frame.data, state);
          for (const out of result.chunks) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(out)}\n\n`));
          }
          if (result.upstreamError) {
            controller.enqueue(errorEventBytes(sanitizeErrorMessage(result.upstreamError)));
            terminated = true;
            options.onComplete({
              promptTokens: state.promptTokens || null,
              outputTokens: state.outputTokens || null,
              reason: "upstream-closed",
            });
            controller.terminate();
            return;
          }
          if (result.terminate) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            terminated = true;
            options.onComplete({
              promptTokens: state.promptTokens || null,
              outputTokens: state.outputTokens || null,
              reason: "completed",
            });
            controller.terminate();
            return;
          }
        }
      } catch (err) {
        if (!terminated) {
          terminated = true;
          controller.enqueue(
            errorEventBytes(
              sanitizeErrorMessage(err instanceof Error ? err.message : "Stream conversion failed")
            )
          );
          options.onComplete({
            promptTokens: state.promptTokens || null,
            outputTokens: state.outputTokens || null,
            reason: "upstream-closed",
          });
          controller.terminate();
        }
      }
    },
    flush(controller) {
      // Source closed with no finishReason -> truncated connection. Null tokens: an upstream
      // that dropped before finishReason produced no confirmed usage report.
      if (!terminated) {
        terminated = true;
        controller.enqueue(errorEventBytes("Upstream connection closed unexpectedly"));
        options.onComplete({ promptTokens: null, outputTokens: null, reason: "upstream-closed" });
      }
    },
    cancel() {
      // The consumer (the client's live HTTP connection via keepaliveStream) went away. Tokens
      // already accounted in `state` were genuinely spent — report them with a distinct reason
      // so the usage log isn't silently missing this cost (design spec §9 post-dial hangup).
      if (!terminated) {
        terminated = true;
        options.onComplete({
          promptTokens: state.promptTokens || null,
          outputTokens: state.outputTokens || null,
          reason: "client-hangup",
        });
      }
    },
  };
  return new TransformStream<Uint8Array, Uint8Array>(transformer);
}
