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

// --- Fix round 1: adversarial findings ---

test("never throws, whatever exotic value it is handed", () => {
  // A caught exception value of unknown type must never become a second exception.
  const throwingToString = {
    toString() {
      throw new Error("boom");
    },
  };
  assert.equal(typeof sanitizeErrorMessage(throwingToString), "string");

  const throwingProxy = new Proxy(
    {},
    {
      get() {
        throw new Error("trap");
      },
      getPrototypeOf() {
        throw new Error("proto trap");
      },
    }
  );
  assert.equal(typeof sanitizeErrorMessage(throwingProxy), "string");

  // Null prototype: no toString at all.
  assert.equal(typeof sanitizeErrorMessage(Object.create(null)), "string");
  // Symbols throw on string concatenation but not on String().
  assert.equal(typeof sanitizeErrorMessage(Symbol("s")), "string");
  // An Error whose message getter throws.
  const badError = new Error("x");
  Object.defineProperty(badError, "message", {
    get() {
      throw new Error("message trap");
    },
  });
  assert.equal(typeof sanitizeErrorMessage(badError), "string");
});

test("redacts keys concatenated into a word (no word boundary)", () => {
  // \b does not exist between two word chars, so a key glued to preceding text slipped out.
  assert.ok(!sanitizeErrorMessage("keysk-1234567890abcdef").includes("1234567890"));
  assert.ok(!sanitizeErrorMessage("XYZsk-abc1234").includes("abc1234"));
});

test("redaction happens before truncation, not after", () => {
  // A key pushed past the 512-char cut must still be redacted, not merely trimmed away.
  const out = sanitizeErrorMessage("b".repeat(500) + "sk-1234567890abcdef");
  assert.ok(!out.includes("sk-12345678"), out.slice(-60));
  assert.ok(!out.includes("1234567890abcdef"), out.slice(-60));
});

test("does not mangle ordinary hyphenated English", () => {
  // Guard against over-broad unanchored key matching.
  assert.ok(sanitizeErrorMessage("task-manager failed").includes("task-manager"));
  assert.ok(sanitizeErrorMessage("disk-space-usage-report").includes("disk-space-usage"));
  assert.ok(sanitizeErrorMessage("risk-assessment done").includes("risk-assessment"));
});

test("redacts non-OpenAI provider key formats", () => {
  const google = sanitizeErrorMessage("key AIzaSyD-9tSrke72I6e6uuEm9dkFmEr5UJc7Q0E here");
  assert.ok(!google.includes("AIzaSyD-9tSrke72I6"), google);

  const github = sanitizeErrorMessage("token ghp_abc123def456ghi789jkl012mno345pqr678 x");
  assert.ok(!github.includes("abc123def456"), github);

  const slack = sanitizeErrorMessage("tok xoxb-123456789012-123456789012-abcdefABCDEF x");
  assert.ok(!slack.includes("123456789012"), slack);

  const jwt = sanitizeErrorMessage(
    "auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4 x"
  );
  assert.ok(!jwt.includes("eyJzdWIi"), jwt);
  assert.ok(!jwt.includes("SflKxwRJ"), jwt);
});

test("strips non-V8 (SpiderMonkey) stack frames", () => {
  const out = sanitizeErrorMessage("Boom\nfn@/srv/app/file.js:1:2\nother@/srv/b.js:3:4");
  assert.ok(!out.includes("fn@"), out);
  assert.ok(!out.includes("other@"), out);
  assert.ok(out.includes("Boom"), out);
});

test("strips bare filenames with line numbers", () => {
  // No directory component, so the absolute-path pattern never fired.
  const out = sanitizeErrorMessage("crash encryption.ts:44:9");
  assert.ok(!out.includes("encryption.ts"), out);
  assert.ok(!out.includes("44:9"), out);
});

test("redaction patterns do not backtrack catastrophically", () => {
  // Hostile upstream text: every pattern must stay bounded. A ReDoS here hangs the
  // whole Node event loop, not just one request.
  const hostile = [
    "a".repeat(10000),
    "/".repeat(10000),
    "sk-" + "a".repeat(10000),
    "Bearer " + "a".repeat(10000),
    "eyJ" + "a".repeat(10000),
    "https://" + "a".repeat(10000),
    "/ab".repeat(3000) + ":1:2",
    "x".repeat(5000) + ".ts:1:1",
    "f@" + "a".repeat(10000),
  ];
  for (const input of hostile) {
    const started = Date.now();
    sanitizeErrorMessage(input);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 250, `pattern took ${elapsed}ms on ${input.slice(0, 12)}...`);
  }
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
