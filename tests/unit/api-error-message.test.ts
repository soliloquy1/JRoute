// tests/unit/api-error-message.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractApiErrorMessage } from "../../src/components/dashboard/apiErrorMessage.ts";

test("extractApiErrorMessage reads .message from the real jsonError()/buildErrorBody() shape", () => {
  // The exact body shape import-models (and every other route using jsonError()) sends.
  const body = { error: { message: "Add a connection with an API key before importing models.", type: "invalid_request_error", code: "invalid_request" } };
  assert.equal(
    extractApiErrorMessage(body, "fallback"),
    "Add a connection with an API key before importing models."
  );
});

test("extractApiErrorMessage never returns the raw error object (the exact shape of the original bug)", () => {
  const body = { error: { message: "boom", type: "api_error", code: "internal_error" } };
  const result = extractApiErrorMessage(body, "fallback");
  assert.equal(typeof result, "string", "must never hand a raw object to setState/toast/React");
});

test("extractApiErrorMessage also accepts a bare-string error (some routes use a custom shape)", () => {
  assert.equal(extractApiErrorMessage({ error: "authorization_pending" }, "fallback"), "authorization_pending");
});

test("extractApiErrorMessage falls back when error is missing, null, or the body itself is null", () => {
  assert.equal(extractApiErrorMessage(null, "fallback"), "fallback");
  assert.equal(extractApiErrorMessage({}, "fallback"), "fallback");
  assert.equal(extractApiErrorMessage({ error: null }, "fallback"), "fallback");
});

test("extractApiErrorMessage falls back when error is an object with no message", () => {
  assert.equal(extractApiErrorMessage({ error: { type: "api_error", code: "x" } }, "fallback"), "fallback");
});
