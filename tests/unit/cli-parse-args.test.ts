// tests/unit/cli-parse-args.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../../bin/parseArgs.mjs";

test("no args defaults to start with browser opening enabled", () => {
  const result = parseArgs([]);
  assert.equal(result.command, "start");
  assert.equal(result.shouldOpenBrowser, true);
  assert.deepEqual(result.passthroughArgs, []);
});

test("--no-open after the command disables opening and is stripped", () => {
  const result = parseArgs(["start", "--no-open"]);
  assert.equal(result.shouldOpenBrowser, false);
  assert.equal(result.command, "start");
  assert.deepEqual(result.passthroughArgs, [], "--no-open must not count as a passthrough flag");
});

test("--no-open before the command also disables opening and is stripped", () => {
  const result = parseArgs(["--no-open", "dev"]);
  assert.equal(result.shouldOpenBrowser, false);
  assert.equal(result.command, "dev");
  assert.deepEqual(result.passthroughArgs, []);
});

test("dev passes other flags through untouched", () => {
  const result = parseArgs(["dev", "--turbo", "-p", "3000"]);
  assert.equal(result.command, "dev");
  assert.deepEqual(result.passthroughArgs, ["--turbo", "-p", "3000"]);
  assert.equal(result.shouldOpenBrowser, true);
});

test("an unknown first token defaults to start and is treated as a passthrough arg", () => {
  const result = parseArgs(["--weird-flag"]);
  assert.equal(result.command, "start");
  assert.deepEqual(result.passthroughArgs, ["--weird-flag"]);
});

test("multiple --no-open occurrences are all stripped", () => {
  const result = parseArgs(["--no-open", "start", "--no-open"]);
  assert.equal(result.shouldOpenBrowser, false);
  assert.equal(result.command, "start");
  assert.deepEqual(result.passthroughArgs, []);
});

test("build is recognized and carries no special passthrough restriction here", () => {
  const result = parseArgs(["build"]);
  assert.equal(result.command, "build");
  assert.deepEqual(result.passthroughArgs, []);
});
