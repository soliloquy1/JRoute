import { openaiConverter } from "./openai.ts";
import type { RequestConverter } from "./types.ts";
import type { WireFormat } from "../../src/lib/db/types.ts";

/**
 * Dispatch point. Adding Gemini in Plan 2c is a registration here, not an edit to
 * handleChat. `anthropic` is registered in Task 6 of this plan.
 */
const CONVERTERS: Partial<Record<WireFormat, RequestConverter>> = {
  openai: openaiConverter,
};

export function getConverter(wireFormat: WireFormat): RequestConverter | null {
  return CONVERTERS[wireFormat] ?? null;
}

export function registerConverter(wireFormat: WireFormat, converter: RequestConverter): void {
  CONVERTERS[wireFormat] = converter;
}
