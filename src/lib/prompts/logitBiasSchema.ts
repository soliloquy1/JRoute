// src/lib/prompts/logitBiasSchema.ts
import { z } from "zod";

// NOTE: the range ceiling/floor is NOT enforced here — clamping to OpenAI's valid
// [-100, 100] happens on write via `clampBiasValue` (global constraint: clamp on write,
// not at the type level), so the schema accepts any integer and lets an out-of-range
// value survive to the clamer rather than being rejected at parse time.
export const LogitBiasEntrySchema = z.object({
  text: z.string().min(1),
  value: z.number().int(),
});

export type LogitBiasEntry = z.infer<typeof LogitBiasEntrySchema>;

/** Clamps a raw (possibly out-of-range or fractional) bias value to OpenAI's valid range. */
export function clampBiasValue(value: number): number {
  return Math.trunc(Math.max(-100, Math.min(100, value)));
}
