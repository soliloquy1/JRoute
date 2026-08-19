// src/lib/prompts/reasoningTagSchema.ts
import { z } from "zod";

export const MAX_REASONING_TAG_PAIRS = 10;
export const MAX_REASONING_TAG_LEN = 100;

export const ReasoningTagPairSchema = z
  .object({
    openTag: z.string().min(1).max(MAX_REASONING_TAG_LEN),
    closeTag: z.string().min(1).max(MAX_REASONING_TAG_LEN),
    // Default false: the common case (Izumi's <konatan_planning~>, and most reasoning
    // presets) always emits an explicit opening tag, so detection can stream live from
    // byte one. Set true only for a pair whose model/provider convention is known to
    // sometimes omit the opening tag — that pair then requires full-response holdback
    // until detection resolves (design spec, Core Algorithm / Known Limitations).
    expectImplicitOpen: z.boolean().default(false),
  })
  .refine((p) => p.openTag !== p.closeTag, {
    message: "openTag and closeTag must differ",
  });

export const ReasoningTagPairsSchema = z
  .array(ReasoningTagPairSchema)
  .max(MAX_REASONING_TAG_PAIRS)
  .superRefine((pairs, ctx) => {
    // Every open/close tag across the whole list must be scanned unambiguously: if one
    // configured tag is a substring of another (e.g. "<think" and "<think>"), "earliest
    // match" at a shared start position is ambiguous. Rejected at write time instead of
    // needing a documented runtime tie-break rule.
    const allTags = pairs.flatMap((p) => [p.openTag, p.closeTag]);
    for (let i = 0; i < allTags.length; i += 1) {
      for (let j = 0; j < allTags.length; j += 1) {
        if (i === j) continue;
        if (allTags[i].includes(allTags[j])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Tag "${allTags[j]}" is a substring of tag "${allTags[i]}" — configured tags must not overlap`,
          });
          return;
        }
      }
    }
  });

export type ReasoningTagPair = z.infer<typeof ReasoningTagPairSchema>;
// The *input* shape a caller may pass without spelling out `expectImplicitOpen` (the
// schema's `.default(false)` fills it). The DB write functions accept this looser shape
// and normalize through `ReasoningTagPairsSchema.parse` before persisting.
export type ReasoningTagPairInput = z.input<typeof ReasoningTagPairSchema>;
export type ReasoningTagPairsInput = z.input<typeof ReasoningTagPairsSchema>;
