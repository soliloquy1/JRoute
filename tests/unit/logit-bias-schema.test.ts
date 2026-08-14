// tests/unit/logit-bias-schema.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LogitBiasEntrySchema, clampBiasValue } from "../../src/lib/prompts/logitBiasSchema.ts";

test("LogitBiasEntrySchema accepts a valid entry", () => {
  const parsed = LogitBiasEntrySchema.safeParse({ text: "suddenly", value: -80 });
  assert.equal(parsed.success, true);
});

test("LogitBiasEntrySchema rejects empty text", () => {
  const parsed = LogitBiasEntrySchema.safeParse({ text: "", value: 0 });
  assert.equal(parsed.success, false);
});

test("LogitBiasEntrySchema rejects a non-integer value at the type level", () => {
  assert.equal(LogitBiasEntrySchema.safeParse({ text: "x", value: 1.5 }).success, false);
});

test("LogitBiasEntrySchema accepts an out-of-range value (clamped on write, not rejected)", () => {
  assert.equal(LogitBiasEntrySchema.safeParse({ text: "x", value: 999 }).success, true);
});

test("clampBiasValue clamps above 100 down to 100", () => {
  assert.equal(clampBiasValue(500), 100);
});

test("clampBiasValue clamps below -100 up to -100", () => {
  assert.equal(clampBiasValue(-500), -100);
});

test("clampBiasValue passes an in-range integer through unchanged", () => {
  assert.equal(clampBiasValue(42), 42);
});

test("clampBiasValue truncates a fractional value toward zero", () => {
  assert.equal(clampBiasValue(12.9), 12);
});
