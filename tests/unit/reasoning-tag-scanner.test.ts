// tests/unit/reasoning-tag-scanner.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReasoningScanner,
  hasReasoningTags,
  applyReasoningTagStrip,
} from "../../src/lib/prompts/reasoningTagScanner.ts";
import { ReasoningTagPairSchema } from "../../src/lib/prompts/reasoningTagSchema.ts";

function pair(overrides: Record<string, unknown>) {
  return ReasoningTagPairSchema.parse({ openTag: "<think>", closeTag: "</think>", ...overrides });
}

test("applyReasoningTagStrip removes an explicit paired block", () => {
  const p = pair({});
  assert.equal(applyReasoningTagStrip("hi <think>secret plan</think> there", [p]), "hi  there");
});

test("applyReasoningTagStrip discards everything from response start when an implicit close arrives first", () => {
  const p = pair({ expectImplicitOpen: true });
  assert.equal(
    applyReasoningTagStrip("all this text is reasoning</think>the real reply", [p]),
    "the real reply"
  );
});

test("applyReasoningTagStrip strips only the token for a straggler close after real content was already visible", () => {
  const p = pair({}); // expectImplicitOpen: false
  // No open tag anywhere; expectImplicitOpen is false, so a bare close is a stray token,
  // not implicit reasoning — everything else is kept.
  assert.equal(applyReasoningTagStrip("normal reply</think>more reply", [p]), "normal replymore reply");
});

test("applyReasoningTagStrip: a block exceeding the memory cap is still fully stripped once its close tag arrives", () => {
  const p = pair({});
  const longReasoning = "x".repeat(30000);
  const text = `<think>${longReasoning}</think>final answer`;
  assert.equal(applyReasoningTagStrip(text, [p]), "final answer");
});

test("applyReasoningTagStrip: truncation (no close tag ever) discards the whole open block", () => {
  const p = pair({});
  assert.equal(applyReasoningTagStrip("before <think>never closes", [p]), "before ");
});

test("applyReasoningTagStrip: a config with only expectImplicitOpen=false pairs never discards a normal reply with no tags", () => {
  const p = pair({});
  assert.equal(applyReasoningTagStrip("just a normal reply, nothing special", [p]), "just a normal reply, nothing special");
});

test("applyReasoningTagStrip: two sequential blocks in one response", () => {
  const p = pair({});
  assert.equal(
    applyReasoningTagStrip("<think>one</think>mid<think>two</think>end", [p]),
    "midend"
  );
});

test("applyReasoningTagStrip: mixed pairs — a false-pair straggler close is spliced out, a later true-pair implicit close still discards from response start", () => {
  const falsePair = ReasoningTagPairSchema.parse({
    openTag: "<a>",
    closeTag: "</a>",
    expectImplicitOpen: false,
  });
  const truePair = ReasoningTagPairSchema.parse({
    openTag: "<b>",
    closeTag: "</b>",
    expectImplicitOpen: true,
  });
  // "</a>" (false pair) shows up first with no open — spliced out, detection continues.
  // "</b>" (true pair) then shows up with no open either — implicit reasoning, discards
  // everything accumulated so far (including the region the stray "</a>" was already
  // removed from) up through "</b>".
  const text = "stray</a>then all of this is reasoning</b>the real reply";
  assert.equal(applyReasoningTagStrip(text, [falsePair, truePair]), "the real reply");
});

test("hasReasoningTags is false for an empty list, true otherwise", () => {
  assert.equal(hasReasoningTags([]), false);
  assert.equal(hasReasoningTags([pair({})]), true);
});

test("scanner: a tag split across two push() calls is still recognized", () => {
  const p = pair({});
  const scanner = createReasoningScanner([p]);
  let out = scanner.push("hello <thi");
  out += scanner.push("nk>secret</think> world");
  out += scanner.finish();
  assert.equal(out, "hello  world");
});

test("scanner: finish() is idempotent", () => {
  const p = pair({});
  const scanner = createReasoningScanner([p]);
  // Text ends with a partial open-tag prefix: push() emits the safe prefix and holds the
  // tail back in buffer; finish() flushes the held tail exactly once (spec: an outside
  // buffer is "normally already empty after each push()", so a second finish() is a no-op).
  const out = scanner.push("hello <thi");
  assert.equal(out, "hello ");
  const first = scanner.finish();
  const second = scanner.finish();
  assert.equal(first, "<thi");
  assert.equal(second, "");
});

test("scanner: a config with only expectImplicitOpen=false pairs starts in outside (streams live before any tag appears)", () => {
  const p = pair({});
  const scanner = createReasoningScanner([p]);
  // Streamed live immediately — no holdback needed since there's no implicit case to
  // protect against for this config.
  assert.equal(scanner.push("hello there, "), "hello there, ");
});

test("scanner: a config with an expectImplicitOpen=true pair holds back plain text until detection resolves", () => {
  const p = pair({ expectImplicitOpen: true });
  const scanner = createReasoningScanner([p]);
  // Nothing emitted yet — still detecting, could still turn into implicit reasoning.
  assert.equal(scanner.push("hello there, "), "");
  assert.equal(scanner.finish(), "hello there, ");
});
