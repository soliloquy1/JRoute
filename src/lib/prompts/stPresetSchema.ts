// src/lib/prompts/stPresetSchema.ts
import { z } from "zod";

/**
 * Real-world SillyTavern exports are messier than the happy-path shape: form
 * values arrive as strings, marker entries carry `content: null`, and the
 * Prompt Manager's "export" produces a FLAT prompt_order (bare order items,
 * no character_id wrapper) or none at all. This schema accepts those shapes
 * and normalizes them, rather than rejecting imports a user cannot diagnose.
 */

const OrderItemSchema = z.looseObject({
  identifier: z.string().min(1),
  enabled: z.boolean(),
});

export const RichPromptEntrySchema = z.looseObject({
  identifier: z.string().min(1),
  name: z.string().default(""),
  role: z.enum(["system", "user", "assistant"]).default("system"),
  // Marker entries (chatHistory, worldInfoBefore, ...) legitimately carry null.
  content: z.string().nullable().optional(),
  system_prompt: z.boolean().optional(),
  marker: z.boolean().optional(),
  // ST form fields are strings; "1" is common in hand-edited/older exports.
  injection_position: z
    .union([z.literal(0), z.literal(1), z.literal("0"), z.literal("1")])
    .optional()
    .transform((v) => (v === undefined ? undefined : (Number(v) as 0 | 1))),
  injection_depth: z.number().int().min(0).optional(),
  injection_order: z.number().int().optional(),
  forbid_overrides: z.boolean().optional(),
});

export const RichPresetOrderEntrySchema = z.looseObject({
  // ST itself compares character_id with String() coercion (PromptManager.js),
  // because mixed string/number ids exist in the wild.
  character_id: z.coerce.number(),
  order: z.array(OrderItemSchema),
});

/**
 * Accepts both the canonical wrapped shape ([{ character_id, order }]) and the
 * Prompt-Manager flat export ([{ identifier, enabled }]). Normalizes to the
 * wrapped shape so every downstream consumer (richAssemble, the editor) sees
 * exactly one form. Empty array is allowed — richAssemble falls back to
 * declaration order, matching what ST does with `prompt_order: []`.
 */
const PromptOrderSchema = z
  .array(z.union([RichPresetOrderEntrySchema, OrderItemSchema]))
  .transform((entries): Array<z.infer<typeof RichPresetOrderEntrySchema>> => {
    const isWrapped = (e: unknown): e is z.infer<typeof RichPresetOrderEntrySchema> =>
      typeof e === "object" && e !== null && "order" in e;
    if (entries.length > 0 && entries.every((e) => !isWrapped(e))) {
      return [{ character_id: 100001, order: entries as Array<z.infer<typeof OrderItemSchema>> }];
    }
    // A MIXED wrapped/flat array is pathological (hand-corrupted export). The flat strays
    // are dropped here — silently losing entries beats crashing the import, and the user
    // can see the missing prompts in the editor afterwards.
    return entries.filter(isWrapped);
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
  prompt_order: PromptOrderSchema,
});

export type RichPromptEntry = z.infer<typeof RichPromptEntrySchema>;
export type RichPresetOrderEntry = z.infer<typeof RichPresetOrderEntrySchema>;
export type RichPresetJson = z.infer<typeof RichPresetJsonSchema>;
