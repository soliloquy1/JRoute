import { convertResponse as anthropicConvertResponse } from "./anthropic/response.ts";
import { createAnthropicStreamTransform } from "./anthropic/stream.ts";
import type { AnthropicResponseJson } from "./anthropic/response.ts";
import type { AnthropicStreamCompletion } from "./anthropic/stream.ts";
import type { WireFormat } from "../../src/lib/db/types.ts";

export interface ResponseConverter {
  convertResponse(json: unknown, requestedModel: string): Record<string, unknown>;
}

export interface StreamConverter {
  wrap(
    inner: ReadableStream<Uint8Array>,
    model: string,
    onComplete: (result: AnthropicStreamCompletion) => void
  ): ReadableStream<Uint8Array>;
}

/**
 * Both registries return `null` for `openai`, deliberately — an OpenAI-shaped upstream
 * already emits OpenAI-shaped output, so there is nothing to convert. This is NOT a stub
 * pending future work; `null` is the entire mechanism, and the call site in `handleChat.ts`
 * treats it as "relay unchanged."
 */
const RESPONSE_CONVERTERS: Partial<Record<WireFormat, ResponseConverter>> = {
  anthropic: {
    convertResponse: (json, model) =>
      anthropicConvertResponse(json as AnthropicResponseJson, model),
  },
};

const STREAM_CONVERTERS: Partial<Record<WireFormat, StreamConverter>> = {
  anthropic: {
    wrap: (inner, model, onComplete) =>
      inner.pipeThrough(createAnthropicStreamTransform({ model, onComplete })),
  },
};

export function getResponseConverter(wireFormat: WireFormat): ResponseConverter | null {
  return RESPONSE_CONVERTERS[wireFormat] ?? null;
}

export function getStreamConverter(wireFormat: WireFormat): StreamConverter | null {
  return STREAM_CONVERTERS[wireFormat] ?? null;
}
