// src/lib/prompts/logitBiasSchema.ts
import { z } from "zod";

export const LogitBiasEntrySchema = z.object({
  text: z.string().min(1),
  value: z.number().int().min(-100).max(100),
});

export type LogitBiasEntry = z.infer<typeof LogitBiasEntrySchema>;

/** Clamps a raw (possibly out-of-range or fractional) bias value to OpenAI's valid range. */
export function clampBiasValue(value: number): number {
  return Math.trunc(Math.max(-100, Math.min(100, value)));
}
