// src/lib/mcp/geminiThoughtSignature.ts
//
// Native-mode plumbing shared between Gemini's request and response converters (design spec
// §6.2 / §8.1). The thought signature is Gemini 3's anti-tamper token: every `functionCall`
// part may carry a sibling `thoughtSignature`, and the NEXT request's matching `model`
// content must re-emit that exact part untouched — otherwise Gemini rejects the turn (the
// reasoning chain can't be verified). It rides through the OpenAI-shaped history on the
// `tool_calls[]._geminiThoughtSignature` field (a name that can never collide with a real
// OpenAI tool-call property), then is re-attached to the `functionCall` part on the way out.
//
// A minimal structural view of the Gemini part shape this module cares about — kept local so
// the converter file's `GeminiPart` union remains the single source of truth for the full type.
interface GeminiPartLike {
  functionCall?: { name: string; args: unknown };
  thoughtSignature?: string;
}

export const GEMINI_THOUGHT_SIG_KEY = "_geminiThoughtSignature";

/** Pull the thought signature off an OpenAI-shaped tool_call, if present. */
export function thoughtSignatureFromToolCall(call: unknown): string | undefined {
  if (typeof call !== "object" || call === null) return undefined;
  const sig = (call as Record<string, unknown>)[GEMINI_THOUGHT_SIG_KEY];
  return typeof sig === "string" ? sig : undefined;
}

/** Attach a captured thought signature onto a Gemini `functionCall` part. */
export function withThoughtSignature(
  part: GeminiPartLike,
  signature: string | undefined
): GeminiPartLike {
  if (!signature) return part;
  return { ...part, thoughtSignature: signature };
}
