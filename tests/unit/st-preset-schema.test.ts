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

test("accepts an empty prompt_order (fresh ST installs ship `prompt_order: []`)", () => {
  const result = RichPresetJsonSchema.safeParse(minimalPreset({ prompt_order: [] }));
  assert.equal(result.success, true);
  assert.deepEqual(result.data!.prompt_order, []);
});

// Real-world SillyTavern export shapes (Prompt Manager "export" produces a FLAT
// prompt_order with no character_id wrapper; form fields arrive as strings).
test("accepts and normalizes a flat prompt_order (Prompt Manager export shape)", () => {
  const result = RichPresetJsonSchema.safeParse(
    minimalPreset({ prompt_order: [{ identifier: "main", enabled: true }] })
  );
  assert.equal(result.success, true);
  assert.deepEqual(result.data!.prompt_order, [
    { character_id: 100001, order: [{ identifier: "main", enabled: true }] },
  ]);
});

test("accepts a string character_id (ST coerces with String() itself)", () => {
  const result = RichPresetJsonSchema.safeParse(
    minimalPreset({ prompt_order: [{ character_id: "100001", order: [{ identifier: "main", enabled: true }] }] })
  );
  assert.equal(result.success, true);
  assert.equal(result.data!.prompt_order[0].character_id, 100001);
});

test("accepts content: null on marker entries", () => {
  const result = RichPresetJsonSchema.safeParse(
    minimalPreset({
      prompts: [{ identifier: "chatHistory", name: "History", role: "system", marker: true, content: null }],
    })
  );
  assert.equal(result.success, true);
  assert.equal(result.data!.prompts[0].content, null);
});

test("accepts injection_position as a string and normalizes to number", () => {
  const result = RichPresetJsonSchema.safeParse(
    minimalPreset({
      prompts: [
        { identifier: "main", name: "Main", role: "system", content: "x", injection_position: "1", injection_depth: 4 },
      ],
    })
  );
  assert.equal(result.success, true);
  assert.equal(result.data!.prompts[0].injection_position, 1);
});

test("rejects a negative injection_depth", () => {
  const result = RichPresetJsonSchema.safeParse(
    minimalPreset({
      prompts: [{ identifier: "main", name: "Main", role: "system", content: "x", injection_position: 1, injection_depth: -2 }],
    })
  );
  assert.equal(result.success, false);
});
