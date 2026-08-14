// src/lib/prompts/logitBiasSchema.ts
import { z } from "zod";

// Size caps. `computeLogitBias` runs synchronously on the hot chat path and re-encodes
// every entry with js-tiktoken on EVERY request (token ids are meaningless without the
// encoding, so they are deliberately not cached at save time — spec §4). An unbounded
// preset is therefore unbounded per-request CPU for whoever is chatting. These ceilings sit
// far above any realistic ban list (SillyTavern's own logit bias UI is dozens of rows of
// single words or short phrases) while keeping the worst case bounded.
export const MAX_LOGIT_BIAS_ENTRIES = 1000;
export const MAX_LOGIT_BIAS_TEXT_LEN = 512;

// NOTE: the range ceiling/floor is NOT enforced here — clamping to OpenAI's valid
// [-100, 100] happens on write via `clampBiasValue` (global constraint: clamp on write,
// not at the type level), so the schema accepts any integer and lets an out-of-range
// value survive to the clamper rather than being rejected at parse time.
export const LogitBiasEntrySchema = z.object({
  text: z.string().min(1).max(MAX_LOGIT_BIAS_TEXT_LEN),
  value: z.number().int(),
});

/** The whole entry list, capped. Shared by the API routes and the DB writers so a direct
 * DB write cannot bypass the ceiling the routes enforce. */
export const LogitBiasEntriesSchema = z.array(LogitBiasEntrySchema).max(MAX_LOGIT_BIAS_ENTRIES);

export type LogitBiasEntry = z.infer<typeof LogitBiasEntrySchema>;

/** Clamps a raw (possibly out-of-range or fractional) bias value to OpenAI's valid range. */
export function clampBiasValue(value: number): number {
  return Math.trunc(Math.max(-100, Math.min(100, value)));
}
