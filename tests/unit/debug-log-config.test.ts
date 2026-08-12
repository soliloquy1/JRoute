// tests/unit/debug-log-config.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDebugLogConfigPath, readDebugLogConfig, isDebugLogEnabled } =
  await import("../../src/lib/debugLog/config.ts");

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("with no config file present, defaults to enabled and writes the default file", () => {
  const path = getDebugLogConfigPath();
  assert.equal(existsSync(path), false);
  const config = readDebugLogConfig();
  assert.equal(config.enabled, true);
  assert.equal(existsSync(path), true);
  const written = JSON.parse(readFileSync(path, "utf8")) as { enabled: boolean };
  assert.equal(written.enabled, true);
});

test("isDebugLogEnabled reflects the config file's current value, re-read every call", () => {
  const path = getDebugLogConfigPath();
  writeFileSync(path, JSON.stringify({ enabled: false }));
  assert.equal(isDebugLogEnabled(), false);
  writeFileSync(path, JSON.stringify({ enabled: true }));
  assert.equal(isDebugLogEnabled(), true);
});

test("a malformed config file fails open to enabled, never crashes", () => {
  const path = getDebugLogConfigPath();
  writeFileSync(path, "{ not valid json");
  assert.equal(isDebugLogEnabled(), true);
});

test("a config file with enabled explicitly omitted defaults that field to true", () => {
  const path = getDebugLogConfigPath();
  writeFileSync(path, JSON.stringify({}));
  assert.equal(isDebugLogEnabled(), true);
});
