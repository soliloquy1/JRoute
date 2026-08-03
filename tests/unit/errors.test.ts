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

// --- Fix round 2: all-alpha tail bypass + uncovered token formats ---

test("redacts embedded keys whose tail has NO digits", () => {
  // The digit requirement was a bypass: an all-alpha key tail survived entirely.
  assert.ok(!sanitizeErrorMessage("keysk-abcdefghijklmnop").includes("abcdefghij"));
  assert.ok(!sanitizeErrorMessage("prefixsk-abcdefghijklmnopqrst").includes("abcdefghij"));
  // jr- is JRoute's own prefix; a future key format with an all-alpha tail must not leak.
  assert.ok(!sanitizeErrorMessage("prefixjr-abcdefghijklmnopqrst").includes("abcdefghij"));
});

test("does not mangle long hyphenated English phrases", () => {
  // Guards the discriminator: a rule based on total tail length (rather than unbroken
  // run length) would redact all of these, because the tail charset spans hyphens.
  for (const phrase of [
    "disk-space-usage-report",
    "risk-assessment-methodology-review",
    "state-of-the-art-disk-subsystem",
    "multi-task-scheduler-service",
    "task-id-12345 missing",
  ]) {
    assert.ok(!sanitizeErrorMessage(phrase).includes("[redacted]"), phrase);
  }
});

test("common non-secret hyphenated/versioned tokens survive intact", () => {
  for (const tok of [
    "covid-19",
    "utf-8",
    "base64-encoded",
    "re-evaluate",
    "x-request-id",
    "HTTP/1.1 404",
    "2026-08-03",
    "v1.2.3-rc1",
    "550e8400-e29b-41d4-a716-446655440000",
  ]) {
    assert.ok(sanitizeErrorMessage(tok).includes(tok), `${tok} -> ${sanitizeErrorMessage(tok)}`);
  }
});

test("redacts a JWT concatenated into a word", () => {
  const out = sanitizeErrorMessage(
    "tokeneyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4"
  );
  assert.ok(!out.includes("eyJzdWIi"), out);
  assert.ok(!out.includes("SflKxwRJ"), out);
});

test("redacts GitHub fine-grained PATs and Slack enterprise tokens", () => {
  const pat = sanitizeErrorMessage(
    "tok github_pat_11ABCDE0Y0abcdefghijkl_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 x"
  );
  assert.ok(!pat.includes("11ABCDE0Y0"), pat);

  const xoxe = sanitizeErrorMessage("tok xoxe-1-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 x");
  assert.ok(!xoxe.includes("ABCDEFGHIJ"), xoxe);
});

test("strips SpiderMonkey frames with spaces in the function name", () => {
  const out = sanitizeErrorMessage("Boom\nmy fn@/srv/app/file.js:1:2\nfn@/srv/b.js:3:4");
  assert.ok(!out.includes("fn@"), out);
  assert.ok(out.includes("Boom"), out);
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

// --- Fix round 3: the frame rule must not eat prose that merely contains "@" ---

test("keeps legitimate error text that contains an @", () => {
  // A permissive pre-"@" class with no required ":line" tail deleted any line whose last
  // token contained an "@" — including most single-line JSON error bodies. buildErrorBody
  // then replaced the emptied message with a bare fallback, so the chatter saw "Internal
  // error" and the operator lost every diagnostic.
  const cases: Array<[string, string]> = [
    [
      `{"error":{"code":403,"message":"Requests from referer are blocked. Contact admin@yourorg.io"}}`,
      "Requests from referer are blocked",
    ],
    ["Cannot find module @scope/pkg", "@scope/pkg"],
    // @cf/... is the literal shape of a Cloudflare Workers AI model id. The "/meta/..."
    // tail is still shortened to [path] by the unrelated POSIX-path rule — pre-existing
    // behavior, byte-identical to 5c0e1c4ad — but the line is no longer deleted outright.
    ["model not found: @cf/meta/llama-3-8b-instruct", "model not found: @cf"],
    ["402 Payment Required for account owner@gmail.com", "402 Payment Required"],
    ["Unexpected token @Injectable", "@Injectable"],
    ["reported by @janitorai", "@janitorai"],
    ["Contact support@example.com now", "support@example.com"],
    ["npm ERR! 404 '@types/node@^20.0.0' is not in this registry", "@types/node"],
  ];
  for (const [input, mustSurvive] of cases) {
    const out = sanitizeErrorMessage(input);
    assert.ok(out.includes(mustSurvive), `${input} -> ${JSON.stringify(out)}`);
  }
});

test("an upstream JSON error body survives buildErrorBody instead of becoming a fallback", () => {
  const body = buildErrorBody(
    403,
    `{"error":{"code":403,"message":"Requests from referer are blocked. Contact admin@yourorg.io"}}`
  );
  assert.notEqual(body.error.message, "Forbidden");
  assert.ok(body.error.message.includes("Requests from referer are blocked"), body.error.message);
});

test("still strips every SpiderMonkey/JSC frame shape", () => {
  // The ":line[:col]" tail is what separates a frame from prose, so pin the shapes that
  // must keep matching — including a bare filename with no directory component.
  for (const frame of [
    "my fn@/srv/app/file.js:1:2",
    "fn@/srv/b.js:3:4",
    "fn@http://h/app/f.js:1:2",
    "<anonymous>@/x.js:9",
    "promise callback*handler@/a/b/c.js:12:34",
    "e/</t@https://cdn.example.com/a.min.js:2:3891",
    "fn@app.js:1:2",
  ]) {
    const out = sanitizeErrorMessage(`Boom\n${frame}`);
    assert.equal(out, "Boom", `${frame} -> ${JSON.stringify(out)}`);
  }
});

test("removes DSN-shaped lines, which carry credentials the URL rule does not cover", () => {
  // The URL rule only handles http/https, so a redis:// or postgres:// DSN would otherwise
  // reach the chatter with its password intact.
  const redis = sanitizeErrorMessage("connect ECONNREFUSED redis://user:pass@10.0.0.1:6379");
  assert.ok(!redis.includes("pass"), redis);
  const pg = sanitizeErrorMessage("auth failed postgres://admin:hunter2@db.internal:5432");
  assert.ok(!pg.includes("hunter2"), pg);
});

// --- Fix round 3: "_" deliberately does not break the key run ---

test("underscore does not break the key run, so underscore-delimited keys still redact", () => {
  // This is the load-bearing direction: real key bodies contain "_", so excluding it from
  // the run charset would let them through. Measured cost of excluding it: an
  // underscore-delimited body in 4-char groups went from 0/20000 missed to 20000/20000.
  assert.ok(!sanitizeErrorMessage("keysk-ABCD_EFGH_IJKL_MNOP_QRST").includes("ABCD_EFGH"));
  assert.ok(!sanitizeErrorMessage("keyjr-abcdefgh_ijklmnop_qrstuvwx").includes("abcdefgh"));
});

test("accepted over-redaction: long snake_case / CamelCase tails after a key prefix", () => {
  // Cosmetic, never a leak, and the direct consequence of the test above. Pinned so that
  // changing it is a deliberate decision rather than an accident. "ExecutionContextDestroyed"
  // is indistinguishable by shape from the all-alpha key tail the >=16 rule exists to catch.
  for (const phrase of [
    "disk-space_usage_report",
    "task-queue_worker_pool_exhausted",
    "husk-ExecutionContextDestroyed",
    "risk-AssessmentControllerFactory",
  ]) {
    assert.ok(sanitizeErrorMessage(phrase).includes("[redacted]"), phrase);
  }
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
    // Round 3: the frame tail now backtracks between [^\s]{1,300} and :\d{1,7}, so stress
    // near-miss lines that force the engine to try every colon before failing.
    (("f".repeat(100) + "@" + "a:1".repeat(90)) as string).repeat(1) + "\n",
    Array(2000)
      .fill("f".repeat(100) + "@" + "a:1".repeat(90))
      .join("\n"),
    Array(2000)
      .fill("f".repeat(100) + "@" + "b".repeat(280) + ":x")
      .join("\n"),
    Array(2000)
      .fill("my fn@" + "/ab".repeat(90))
      .join("\n"),
    Array(2000)
      .fill("@" + "a".repeat(299) + ":1:2")
      .join("\n"),
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
