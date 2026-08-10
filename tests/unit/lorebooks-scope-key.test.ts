// tests/unit/lorebooks-scope-key.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeKeyFor } from "../../src/lib/lorebooks/scopeKey.ts";

test("global scope always returns the literal string 'global', ignoring the prompt", () => {
  assert.equal(scopeKeyFor("global", "Ada is a helpful robot."), "global");
  assert.equal(scopeKeyFor("global", "completely different card"), "global");
});

test("character scope hashes the normalized prompt, stable across identical input", () => {
  const a = scopeKeyFor("character", "Ada is a helpful robot.");
  const b = scopeKeyFor("character", "Ada is a helpful robot.");
  assert.equal(a, b);
  assert.notEqual(a, "global");
});

test("character scope is stable across cosmetic edits — whitespace and case (design spec 7.3 #2)", () => {
  const a = scopeKeyFor("character", "Ada is a helpful robot.");
  const b = scopeKeyFor("character", "  ADA IS A   helpful robot.  \n\n");
  assert.equal(a, b, "trim/collapse-whitespace/lowercase must normalize before hashing");
});

test("character scope changes when the actual content changes", () => {
  const a = scopeKeyFor("character", "Ada is a helpful robot.");
  const b = scopeKeyFor("character", "Ada is a helpful robot, mostly.");
  assert.notEqual(a, b);
});

test("character scope hash is deterministic and reasonably short (hex digest, not the raw prompt)", () => {
  const key = scopeKeyFor("character", "Ada is a helpful robot.");
  assert.match(key, /^[0-9a-f]{64}$/, "expected a sha256 hex digest");
});
