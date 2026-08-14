// tests/unit/logit-bias-schema.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LogitBiasEntrySchema,
  LogitBiasEntriesSchema,
  MAX_LOGIT_BIAS_ENTRIES,
  MAX_LOGIT_BIAS_TEXT_LEN,
  clampBiasValue,
} from "../../src/lib/prompts/logitBiasSchema.ts";

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

test("LogitBiasEntrySchema rejects text longer than the per-entry cap", () => {
  const text = "a".repeat(MAX_LOGIT_BIAS_TEXT_LEN + 1);
  assert.equal(LogitBiasEntrySchema.safeParse({ text, value: 0 }).success, false);
  assert.equal(
    LogitBiasEntrySchema.safeParse({ text: text.slice(0, MAX_LOGIT_BIAS_TEXT_LEN), value: 0 })
      .success,
    true
  );
});

test("LogitBiasEntriesSchema rejects more entries than the cap", () => {
  const entry = { text: "x", value: 0 };
  assert.equal(
    LogitBiasEntriesSchema.safeParse(Array(MAX_LOGIT_BIAS_ENTRIES).fill(entry)).success,
    true
  );
  assert.equal(
    LogitBiasEntriesSchema.safeParse(Array(MAX_LOGIT_BIAS_ENTRIES + 1).fill(entry)).success,
    false
  );
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
