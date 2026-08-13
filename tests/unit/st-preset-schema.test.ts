// tests/unit/st-preset-schema.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { RichPresetJsonSchema } from "../../src/lib/prompts/stPresetSchema.ts";

function minimalPreset(overrides: Record<string, unknown> = {}) {
  return {
    temperature: 1,
    top_p: 0.99,
    prompts: [
      {
        identifier: "main",
        name: "Main Prompt",
        role: "system",
        content: "Write a reply.",
        system_prompt: true,
      },
    ],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
    ...overrides,
  };
}

test("accepts a minimal valid preset shape", () => {
  const parsed = RichPresetJsonSchema.parse(minimalPreset());
  assert.equal(parsed.prompts.length, 1);
  assert.equal(parsed.prompt_order[0].order[0].identifier, "main");
});

test("preserves unknown top-level fields instead of stripping them", () => {
  const parsed = RichPresetJsonSchema.parse(
    minimalPreset({ some_future_st_field: "keep-me" })
  ) as Record<string, unknown>;
  assert.equal(parsed.some_future_st_field, "keep-me");
});

test("rejects a preset with no prompts array", () => {
  const { prompts, ...rest } = minimalPreset();
  const result = RichPresetJsonSchema.safeParse(rest);
  assert.equal(result.success, false);
});

test("rejects an empty prompts array", () => {
  const result = RichPresetJsonSchema.safeParse(minimalPreset({ prompts: [] }));
  assert.equal(result.success, false);
});

test("rejects a preset with no prompt_order entries", () => {
  const result = RichPresetJsonSchema.safeParse(minimalPreset({ prompt_order: [] }));
  assert.equal(result.success, false);
});
