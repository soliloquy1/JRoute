// tests/unit/errors.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeErrorMessage, buildErrorBody, jsonError } from "../../jroute/errors.ts";

test("strips absolute filesystem paths", () => {
  const out = sanitizeErrorMessage("failed at /Users/westin/app/src/main.ts:42:7");
  assert.ok(!out.includes("/Users/westin"), out);
  assert.ok(!out.includes("main.ts"), out);
});

test("strips stack frames", () => {
  const out = sanitizeErrorMessage(
    "Boom\n    at foo (/srv/app/x.js:1:2)\n    at bar (/srv/y.js:3:4)"
  );
  assert.ok(!out.includes("at foo"), out);
  assert.ok(out.includes("Boom"), out);
});

test("redacts bearer tokens and API keys", () => {
  assert.ok(!sanitizeErrorMessage("Authorization: Bearer sk-abcdef123456").includes("sk-abcdef"));
  assert.ok(!sanitizeErrorMessage("bad key sk-proj-AAAABBBBCCCCDDDD").includes("AAAABBBB"));
});

test("strips URLs with credentials or query strings", () => {
  const out = sanitizeErrorMessage("GET https://api.example.com/v1/x?key=secret123 failed");
  assert.ok(!out.includes("secret123"), out);
});

test("handles non-string input without throwing", () => {
  assert.equal(typeof sanitizeErrorMessage(new Error("plain")), "string");
  assert.equal(typeof sanitizeErrorMessage(null), "string");
  assert.equal(typeof sanitizeErrorMessage({ a: 1 }), "string");
});

test("truncates very long messages", () => {
  assert.ok(sanitizeErrorMessage("x".repeat(5000)).length <= 512);
});

test("buildErrorBody maps status to type and code", () => {
  assert.deepEqual(buildErrorBody(401, "Invalid API key"), {
    error: { message: "Invalid API key", type: "authentication_error", code: "invalid_api_key" },
  });
  assert.equal(buildErrorBody(429, "slow down").error.type, "rate_limit_error");
  assert.equal(buildErrorBody(503, "nope").error.type, "api_error");
});

test("buildErrorBody sanitizes the message it is given", () => {
  const body = buildErrorBody(500, "crash at /srv/app/main.js:9");
  assert.ok(!body.error.message.includes("/srv/app"));
});

test("buildErrorBody substitutes a default for an empty message", () => {
  assert.ok(buildErrorBody(500, "").error.message.length > 0);
});

test("jsonError returns a JSON Response with merged headers", async () => {
  const res = jsonError(400, "bad", { "access-control-allow-origin": "*" });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const body = (await res.json()) as { error: { message: string } };
  assert.equal(body.error.message, "bad");
});
