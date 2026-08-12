// tests/unit/debug-log-logger.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDebugLogConfigPath } = await import("../../src/lib/debugLog/config.ts");
const { debugLog, debugLogError, debugLogFilePath, redactHeaders } =
  await import("../../src/lib/debugLog/logger.ts");

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readLoggedLines(): Array<Record<string, unknown>> {
  const path = debugLogFilePath();
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("debugLog writes a JSON-line to the debug log file when enabled (default)", () => {
  debugLog("test-category", { requestId: "req-1", detail: "hello" });
  const lines = readLoggedLines();
  const entry = lines.find((l) => l.requestId === "req-1");
  assert.ok(entry, "expected a log line for req-1");
  assert.equal(entry?.category, "test-category");
  assert.equal(entry?.detail, "hello");
  assert.equal(entry?.level, "info");
  assert.ok(typeof entry?.time === "string");
});

test("debugLog does zero file I/O when disabled", () => {
  writeFileSync(getDebugLogConfigPath(), JSON.stringify({ enabled: false }));
  const before = existsSync(debugLogFilePath()) ? readFileSync(debugLogFilePath(), "utf8") : "";
  debugLog("should-not-appear", { requestId: "req-disabled" });
  const afterWrite = existsSync(debugLogFilePath()) ? readFileSync(debugLogFilePath(), "utf8") : "";
  assert.equal(afterWrite, before, "log file must not grow while disabled");
  writeFileSync(getDebugLogConfigPath(), JSON.stringify({ enabled: true }));
});

test("debugLog redacts a bearer token in logged data", () => {
  debugLog("auth-test", {
    requestId: "req-secret",
    headers: { authorization: "Bearer sk-abcdefghijklmnopqrstuvwx" },
  });
  const lines = readLoggedLines();
  const entry = lines.find((l) => l.requestId === "req-secret");
  assert.ok(entry);
  const headers = entry?.headers as { authorization: string };
  assert.ok(!headers.authorization.includes("sk-abcdefghijklmnopqrstuvwx"));
  assert.match(headers.authorization, /REDACTED/);
});

test("redactHeaders masks x-api-key by key name, even though its jr- shape matches no content pattern", () => {
  // The bug this guards: logRedaction.ts redacts by VALUE content ("Bearer ...", "sk-...")
  // and has no way to see a header's KEY name. A live jroute proxy key (format
  // "jr-<64 hex chars>", src/lib/auth/apiKeys.ts) authenticated via the x-api-key header
  // matches none of logRedaction's content patterns, so it passed through untouched before
  // this fix — a real credential leak into a log designed to be pasted to a third party.
  const raw = {
    "x-api-key": "jr-90ec158ea4df705b3a75522d0e24e983c655b76267b45ec42c89e62fe4e3f378",
    "content-type": "application/json",
  };
  const redacted = redactHeaders(raw);
  assert.equal(redacted["x-api-key"], "[REDACTED]");
  assert.equal(redacted["content-type"], "application/json", "non-sensitive headers pass through");
});

test("debugLog never leaks a raw x-api-key value end-to-end through request-shaped logging", () => {
  debugLog("request.received", {
    requestId: "req-xapikey",
    headers: redactHeaders({
      "x-api-key": "jr-90ec158ea4df705b3a75522d0e24e983c655b76267b45ec42c89e62fe4e3f378",
    }),
  });
  const lines = readLoggedLines();
  const entry = lines.find((l) => l.requestId === "req-xapikey");
  assert.ok(entry);
  const headers = entry?.headers as { "x-api-key": string };
  assert.equal(headers["x-api-key"], "[REDACTED]");
});

test("debugLogError logs a real Error with a redacted message/stack and never throws", () => {
  const err = new Error("upstream failed: Bearer sk-abcdefghijklmnopqrstuvwx");
  assert.doesNotThrow(() => debugLogError("upstream-error", err, { requestId: "req-err" }));
  const lines = readLoggedLines();
  const entry = lines.find((l) => l.requestId === "req-err");
  assert.ok(entry);
  assert.equal(entry?.level, "error");
  const message = entry?.errMessage as string;
  assert.ok(!message.includes("sk-abcdefghijklmnopqrstuvwx"), "error message must be redacted too");
  assert.match(message, /REDACTED/);
});

test("debugLog never throws even when DATA_DIR cannot be created (a file sits where the directory should be)", () => {
  const blockedPath = join(dir, "blocked-by-a-file");
  writeFileSync(blockedPath, "not a directory");
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = blockedPath;
  try {
    // dataDir() will try mkdirSync() on a path that already exists as a regular file —
    // a real, uncontrived failure mode (a stray file, a bad DATA_DIR env value).
    assert.doesNotThrow(() => debugLog("resilience-check", { requestId: "req-blocked-dir" }));
  } finally {
    process.env.DATA_DIR = previousDataDir;
  }
});
