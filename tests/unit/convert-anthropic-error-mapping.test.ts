// tests/unit/convert-anthropic-error-mapping.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapAnthropicErrorMessage } from "../../jroute/convert/anthropic/errorMapping.ts";

test("a billing_error gets a distinct, operator-actionable message", () => {
  // Raw message is deliberately neutral (no "billing"/"credit" words) so the assertion
  // can ONLY pass because mapAnthropicErrorMessage added the billing prefix, not because
  // the upstream text happened to contain the word.
  const raw = '{"type":"error","error":{"type":"billing_error","message":"Forbidden."}}';
  const out = mapAnthropicErrorMessage(raw);
  assert.ok(
    out.toLowerCase().includes("billing"),
    "billing_error must be labeled as a billing problem"
  );
  assert.notEqual(
    out,
    "Forbidden.",
    "must not pass the bare message through — the billing distinction is the point"
  );
});

test("a permission_error is left distinguishable from a billing_error", () => {
  // IDENTICAL raw message on both; the ONLY thing that can make them differ is the
  // billing-prefix branch. If that branch is removed, both return "Forbidden." and this
  // fails.
  const billing = mapAnthropicErrorMessage(
    '{"type":"error","error":{"type":"billing_error","message":"Forbidden."}}'
  );
  const permission = mapAnthropicErrorMessage(
    '{"type":"error","error":{"type":"permission_error","message":"Forbidden."}}'
  );
  assert.notEqual(
    billing,
    permission,
    "billing_error and permission_error must not collapse to the same message"
  );
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
