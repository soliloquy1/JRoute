// tests/unit/regex-apply.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRegexScript,
  applyRegexScripts,
  hasActiveScripts,
  applyRegexScriptsToContent,
} from "../../src/lib/prompts/regexApply.ts";
import { RegexScriptSchema } from "../../src/lib/prompts/regexScriptSchema.ts";

function script(overrides: Record<string, unknown>) {
  return RegexScriptSchema.parse({ scriptName: "t", findRegex: "/x/", ...overrides });
}

const CTX = { char: "Rin", user: "Anon" };

test("applyRegexScript replaces every match with the global flag forced", () => {
  const s = script({ findRegex: "/a/", replaceString: "b" });
  assert.equal(applyRegexScript("aaa", s, 2, CTX), "bbb");
});

test("applyRegexScript skips a disabled script", () => {
  const s = script({ findRegex: "/a/", replaceString: "b", disabled: true });
  assert.equal(applyRegexScript("aaa", s, 2, CTX), "aaa");
});

test("applyRegexScript skips a script not assigned to this placement", () => {
  const s = script({ findRegex: "/a/", replaceString: "b", placement: [1] });
  assert.equal(applyRegexScript("aaa", s, 2, CTX), "aaa");
});

test("applyRegexScript supports $1-$9 capture groups", () => {
  const s = script({ findRegex: "/(\\w+)@(\\w+)/", replaceString: "$2:$1" });
  assert.equal(applyRegexScript("user@host", s, 2, CTX), "host:user");
});

test("applyRegexScript treats {{match}} as the whole (trimmed) match", () => {
  const s = script({ findRegex: "/foo/", replaceString: "<{{match}}>" });
  assert.equal(applyRegexScript("foo", s, 2, CTX), "<foo>");
});

test("applyRegexScript strips trimStrings from the matched text before substitution", () => {
  const s = script({ findRegex: "/\\[foo\\]/", replaceString: "{{match}}", trimStrings: ["[", "]"] });
  assert.equal(applyRegexScript("[foo]", s, 2, CTX), "foo");
});

test("applyRegexScript leaves an out-of-range group reference empty, not literal", () => {
  const s = script({ findRegex: "/(a)/", replaceString: "[$1][$5]" });
  assert.equal(applyRegexScript("a", s, 2, CTX), "[a][]");
});

test("applyRegexScript $$ produces a literal dollar sign", () => {
  const s = script({ findRegex: "/a/", replaceString: "$$1" });
  assert.equal(applyRegexScript("a", s, 2, CTX), "$1");
});

test("substituteRegex=0 (default) leaves {{char}}/{{user}} in findRegex unsubstituted", () => {
  const s = script({ findRegex: "/\\{\\{char\\}\\}/", replaceString: "X", substituteRegex: 0 });
  assert.equal(applyRegexScript("{{char}}", s, 2, CTX), "X");
  assert.equal(applyRegexScript("Rin", s, 2, CTX), "Rin");
});

test("substituteRegex=1 substitutes macros into findRegex raw", () => {
  const s = script({ findRegex: "/{{char}}/", replaceString: "X", substituteRegex: 1 });
  assert.equal(applyRegexScript("Rin", s, 2, CTX), "X");
});

test("substituteRegex=2 escapes macro values before substituting into findRegex", () => {
  const ctxWithDot = { char: "A.J.", user: "Anon" };
  const s = script({ findRegex: "/{{char}}/", replaceString: "X", substituteRegex: 2 });
  assert.equal(applyRegexScript("A.J.", s, 2, ctxWithDot), "X");
  assert.equal(applyRegexScript("AZJZ", s, 2, ctxWithDot), "AZJZ");
});

test("applyRegexScript fails soft and returns the original text on a bad pattern", () => {
  const s = script({ findRegex: "not[a valid regex", replaceString: "X" });
  assert.equal(applyRegexScript("hello", s, 2, CTX), "hello");
});

test("applyRegexScript fails soft when substituteRegex=1 turns a safe pattern catastrophic after macro substitution", () => {
  // Write-time validation only sees the raw "{{char}}" placeholder — the actual compiled
  // pattern after substitution is the classic nested-quantifier ReDoS shape (a+)+$. Must
  // be caught at apply time too, not just executed against the real request/response
  // text. Input is short and fully matching on purpose (fast either way — the exponential
  // blowup this pattern is dangerous for only appears on long *non*-matching near-misses,
  // which this test deliberately never constructs) so the pre-fix behavior fails cleanly
  // and quickly instead of hanging: unguarded, (a+)+$ matches "aaaa" outright and replaces
  // it with "X"; guarded, the unsafe pattern is skipped and the text passes through.
  const s = script({
    findRegex: "/({{char}}+)+$/",
    replaceString: "X",
    substituteRegex: 1,
  });
  const catastrophicCtx = { char: "a", user: "" };
  assert.equal(applyRegexScript("aaaa", s, 2, catastrophicCtx), "aaaa");
});

test("applyRegexScripts applies scripts in array order", () => {
  const upper = script({ findRegex: "/a/", replaceString: "A" });
  const bang = script({ findRegex: "/A/", replaceString: "A!" });
  assert.equal(applyRegexScripts("a", [upper, bang], 2, CTX), "A!");
});

test("hasActiveScripts is true only when an enabled script targets the placement", () => {
  const disabled = script({ placement: [2], disabled: true });
  const wrongPlacement = script({ placement: [1] });
  const active = script({ placement: [2] });
  assert.equal(hasActiveScripts([disabled, wrongPlacement], 2), false);
  assert.equal(hasActiveScripts([disabled, wrongPlacement, active], 2), true);
});

test("applyRegexScriptsToContent transforms string content directly", () => {
  const s = script({ findRegex: "/a/", replaceString: "b" });
  assert.equal(applyRegexScriptsToContent("aaa", [s], 2, CTX), "bbb");
});

test("applyRegexScriptsToContent transforms only text parts of array content", () => {
  const s = script({ findRegex: "/a/", replaceString: "b" });
  const content = [
    { type: "text", text: "aaa" },
    { type: "image_url", image_url: { url: "aaa" } },
  ];
  const out = applyRegexScriptsToContent(content, [s], 2, CTX) as typeof content;
  assert.equal(out[0].text, "bbb");
  assert.deepEqual(out[1], { type: "image_url", image_url: { url: "aaa" } });
});

test("applyRegexScriptsToContent passes null/undefined content through unchanged", () => {
  const s = script({ findRegex: "/a/", replaceString: "b" });
  assert.equal(applyRegexScriptsToContent(null, [s], 2, CTX), null);
  assert.equal(applyRegexScriptsToContent(undefined, [s], 2, CTX), undefined);
});
