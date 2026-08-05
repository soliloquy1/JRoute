// tests/unit/convert-anthropic-error-mapping.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapAnthropicErrorMessage } from "../../jroute/convert/anthropic/errorMapping.ts";

test("a billing_error gets a distinct, operator-actionable message", () => {
  const raw =
    '{"type":"error","error":{"type":"billing_error","message":"Your organization has insufficient credit balance."}}';
  const out = mapAnthropicErrorMessage(raw);
  assert.ok(out.toLowerCase().includes("billing") || out.toLowerCase().includes("credit"));
});

test("a permission_error is left distinguishable from a billing_error", () => {
  const billing = mapAnthropicErrorMessage(
    '{"type":"error","error":{"type":"billing_error","message":"insufficient credit"}}'
  );
  const permission = mapAnthropicErrorMessage(
    '{"type":"error","error":{"type":"permission_error","message":"forbidden"}}'
  );
  assert.notEqual(billing, permission);
});

test("an unrecognized error type passes the message through unchanged", () => {
  const raw = "some plain-text upstream failure with no JSON structure at all";
  assert.equal(mapAnthropicErrorMessage(raw), raw);
});

test("malformed JSON does not throw and passes through unchanged", () => {
  const raw = '{"type":"error"'; // truncated / malformed
  assert.doesNotThrow(() => mapAnthropicErrorMessage(raw));
  assert.equal(mapAnthropicErrorMessage(raw), raw);
});

test("a well-formed error body with an unmapped type still surfaces its own message", () => {
  const raw = '{"type":"error","error":{"type":"not_found_error","message":"model not found"}}';
  const out = mapAnthropicErrorMessage(raw);
  assert.ok(out.includes("model not found"));
});
