// src/lib/prompts/stPresetSchema.ts
import { z } from "zod";

export const RichPromptEntrySchema = z.looseObject({
  identifier: z.string().min(1),
  name: z.string().default(""),
  role: z.enum(["system", "user", "assistant"]).default("system"),
  content: z.string().optional(),
  system_prompt: z.boolean().optional(),
  marker: z.boolean().optional(),
  injection_position: z.union([z.literal(0), z.literal(1)]).optional(),
  injection_depth: z.number().int().optional(),
  injection_order: z.number().int().optional(),
  forbid_overrides: z.boolean().optional(),
});

export const RichPresetOrderEntrySchema = z.looseObject({
  character_id: z.number(),
  order: z.array(z.looseObject({ identifier: z.string().min(1), enabled: z.boolean() })),
});

export const RichPresetJsonSchema = z.looseObject({
  temperature: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
  top_a: z.number().optional(),
  min_p: z.number().optional(),
  repetition_penalty: z.number().optional(),
  seed: z.number().optional(),
  n: z.number().optional(),
  prompts: z.array(RichPromptEntrySchema).min(1),
  prompt_order: z.array(RichPresetOrderEntrySchema).min(1),
});

export type RichPromptEntry = z.infer<typeof RichPromptEntrySchema>;
export type RichPresetOrderEntry = z.infer<typeof RichPresetOrderEntrySchema>;
export type RichPresetJson = z.infer<typeof RichPresetJsonSchema>;
