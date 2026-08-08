import { test } from "node:test";
import assert from "node:assert/strict";
import { anthropicConverter } from "../../jroute/convert/anthropic/request.ts";
import type { TaggedBlock } from "../../jroute/convert/types.ts";

interface OutMessage {
  role: string;
  content: Array<{ type: string; text?: string }>;
}

const convert = (messages: unknown[], blocks: TaggedBlock[] = []) =>
  anthropicConverter.convertRequest({
    model: "claude-sonnet-4-6",
    maxTokens: 64000,
    body: { model: "claude-sonnet-4-6", messages },
    blocks,
  });

const texts = (m: OutMessage) => m.content.filter((b) => b.type === "text").map((b) => b.text);

// §6.3 #4 — leading assistant turn. Fires on ~100% of Janitor traffic.

test("drops a leading assistant greeting", () => {
  const out = convert([
    { role: "assistant", content: "Hello, traveller." },
    { role: "user", content: "hi" },
  ]);
  const messages = out.messages as OutMessage[];
  assert.equal(messages[0].role, "user", "the first message must be a user turn");
});

test("absorbs the leading greeting rather than losing it entirely", () => {
  const out = convert([
    { role: "assistant", content: "Hello, traveller." },
    { role: "user", content: "hi" },
  ]);
  const system = JSON.stringify(out.system ?? []);
  assert.ok(
    system.includes("Hello, traveller."),
    "the greeting is character content — absorb it into system, do not discard it"
  );
});

test("a conversation already starting with user is untouched", () => {
  const out = convert([
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
  ]);
  const messages = out.messages as OutMessage[];
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, "user");
});

// §6.3 #7 CORRECTED — trailing assistant prefill 400s on Claude 4.6+.

test("drops a trailing assistant prefill", () => {
  const out = convert([
    { role: "user", content: "u1" },
    { role: "assistant", content: "Sure, here goes:" },
  ]);
  const messages = out.messages as OutMessage[];
  assert.equal(
    messages[messages.length - 1].role,
    "user",
    "Claude 4.6+ 400s unless the conversation ends with a user message"
  );
});

test("a trailing assistant turn does not strand an injection", () => {
  const out = convert(
    [
      { role: "user", content: "u1" },
      { role: "assistant", content: "prefill" },
    ],
    [{ role: "system", content: "LORE", tag: "depth-injection", depth: 0 }]
  );
  const messages = out.messages as OutMessage[];
  const found = messages.some((m) => texts(m).includes("LORE"));
  assert.ok(found, "the injection must survive the prefill drop");
});

// The test above does NOT actually distinguish step-order (place-then-drop vs.
// drop-then-place): with only one user turn and one trailing assistant turn, both orders
// land the depth-0 injection on the same (only) user message — running dropTrailingAssistant
// first happens to leave placeInjections with nothing else to disagree about. Traced while
// verifying the mutation bar for "dropTrailingAssistant runs BEFORE placeInjections": that
// mutant does NOT fail the test above. This test uses a 4-turn history with a NON-zero
// depth so the two orders disagree on WHICH message receives the injection — depth counts
// from the end, and the count of "messages from the end" changes depending on whether the
// trailing assistant turn has already been removed when depth-counting happens.
test("depth-counting for the injection is measured before the trailing assistant is dropped", () => {
  const out = convert(
    [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2 prefill" },
    ],
    [{ role: "system", content: "ORDERTAG", tag: "depth-injection", depth: 1 }]
  );
  const messages = out.messages as OutMessage[];
  assert.equal(messages.length, 3, "the trailing prefill (a2) is dropped");
  assert.equal(messages[messages.length - 1].role, "user");
  assert.ok(
    texts(messages[2]).includes("ORDERTAG"),
    "depth 1 must target u2 (index 2 of the original 4-message history), not u1 " +
      "(what depth 1 would resolve to if the trailing assistant were dropped FIRST, " +
      "shrinking the history to 3 messages before depth-counting)"
  );
  assert.ok(
    !texts(messages[0]).includes("ORDERTAG"),
    "the injection must not have landed on u1"
  );
});

// §6.3 #6 — empty content 400s.

test("strips empty-string content messages", () => {
  const out = convert([
    { role: "user", content: "u1" },
    { role: "assistant", content: "" },
    { role: "user", content: "u2" },
  ]);
  const messages = out.messages as OutMessage[];
  assert.equal(messages.length, 2, "an empty message must not be sent");
  assert.ok(messages.every((m) => m.content.length > 0));
});

test("strips messages whose block array is empty", () => {
  const out = convert([
    { role: "user", content: [] },
    { role: "user", content: "u1" },
  ]);
  const messages = out.messages as OutMessage[];
  assert.equal(messages.length, 1);
});

test("never emits a message with zero content blocks", () => {
  const out = convert([
    { role: "user", content: null },
    { role: "user", content: "u1" },
    { role: "assistant", content: undefined },
    { role: "user", content: "u2" },
  ]);
  const messages = out.messages as OutMessage[];
  assert.ok(messages.every((m) => m.content.length > 0), "Anthropic 400s on empty content");
});

// §6.3 #5 — Janitor's Custom Prompt can emit a second system message or trailing turn.

test("a second client system message is also hoisted, in order", () => {
  const out = convert([
    { role: "system", content: "first system" },
    { role: "user", content: "u1" },
    { role: "system", content: "second system" },
    { role: "user", content: "u2" },
  ]);
  assert.deepEqual(out.system, [
    { type: "text", text: "first system" },
    { type: "text", text: "second system" },
  ]);
  const messages = out.messages as OutMessage[];
  assert.ok(messages.every((m) => m.role !== "system"));
});

// Everything together — the realistic Janitor shape.

test("a realistic Janitor conversation converts to a valid Anthropic request", () => {
  const out = convert(
    [
      { role: "system", content: "You are Ada. Stay in character." },
      { role: "assistant", content: "*waves* Hello!" },
      { role: "user", content: "hi Ada" },
      { role: "assistant", content: "How are you?" },
      { role: "user", content: "good" },
    ],
    [
      { role: "system", content: "CARD", tag: "system-block" },
      { role: "system", content: "LORE", tag: "depth-injection", depth: 1 },
    ]
  );

  const messages = out.messages as OutMessage[];
  assert.equal(messages[0].role, "user", "must start with a user turn");
  assert.equal(messages[messages.length - 1].role, "user", "must end with a user turn");
  assert.ok(messages.every((m) => m.role === "user" || m.role === "assistant"));
  assert.ok(messages.every((m) => m.content.length > 0));
  assert.ok(typeof out.max_tokens === "number" && (out.max_tokens as number) > 0);

  const system = JSON.stringify(out.system ?? []);
  assert.ok(system.includes("CARD"));
  assert.ok(!system.includes("LORE"), "the injection must never reach system");
  assert.ok(
    messages.some((m) => texts(m).includes("LORE")),
    "the injection must survive into message content"
  );
});
