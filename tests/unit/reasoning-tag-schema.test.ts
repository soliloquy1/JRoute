// tests/unit/reasoning-tag-schema.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ReasoningTagPairSchema, ReasoningTagPairsSchema } from "../../src/lib/prompts/reasoningTagSchema.ts";

test("ReasoningTagPairSchema fills expectImplicitOpen default", () => {
  const parsed = ReasoningTagPairSchema.parse({ openTag: "<a>", closeTag: "</a>" });
  assert.equal(parsed.expectImplicitOpen, false);
});

test("ReasoningTagPairSchema rejects openTag === closeTag", () => {
  const result = ReasoningTagPairSchema.safeParse({ openTag: "<a>", closeTag: "<a>" });
  assert.equal(result.success, false);
});

test("ReasoningTagPairsSchema accepts a normal short list", () => {
  const parsed = ReasoningTagPairsSchema.parse([
    { openTag: "<think>", closeTag: "</think>" },
    { openTag: "<konatan_planning~>", closeTag: "</konatan_planning~>", expectImplicitOpen: true },
  ]);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].expectImplicitOpen, true);
});

test("ReasoningTagPairsSchema rejects a tag that is a substring of another configured tag", () => {
  const result = ReasoningTagPairsSchema.safeParse([
    { openTag: "<think", closeTag: "</think>" },
    { openTag: "<think>", closeTag: "</thinking>" },
  ]);
  assert.equal(result.success, false);
});

test("ReasoningTagPairsSchema rejects more than the cap", () => {
  const tooMany = Array.from({ length: 11 }, (_, i) => ({
    openTag: `<a${i}>`,
    closeTag: `</a${i}>`,
  }));
  const result = ReasoningTagPairsSchema.safeParse(tooMany);
  assert.equal(result.success, false);
});
