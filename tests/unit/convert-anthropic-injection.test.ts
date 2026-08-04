import { test } from "node:test";
import assert from "node:assert/strict";
import { anthropicConverter } from "../../jroute/convert/anthropic/request.ts";
import type { TaggedBlock } from "../../jroute/convert/types.ts";

interface OutMessage {
  role: string;
  content: Array<{ type: string; text?: string }>;
}

const convert = (messages: unknown[], blocks: TaggedBlock[]) =>
  anthropicConverter.convertRequest({
    model: "claude-sonnet-4-6",
    maxTokens: 64000,
    body: { model: "claude-sonnet-4-6", messages },
    blocks,
  });

const texts = (m: OutMessage) => m.content.filter((b) => b.type === "text").map((b) => b.text);

/** A conversation whose turns are individually identifiable. */
const history = () => [
  { role: "user", content: "u1" },
  { role: "assistant", content: "a1" },
  { role: "user", content: "u2" },
  { role: "assistant", content: "a2" },
  { role: "user", content: "u3" },
];

const inject = (depth: number, content = "LORE"): TaggedBlock => ({
  role: "system",
  content,
  tag: "depth-injection",
  depth,
});

// ---------------------------------------------------------------------------
// GUARD 1 — teleport to top. A depth-injection must never reach the system param.
// ---------------------------------------------------------------------------

test("a depth-injection never appears in the system param", () => {
  const out = convert(history(), [inject(2)]);
  const system = JSON.stringify(out.system ?? []);
  assert.ok(!system.includes("LORE"), "depth-injection must NOT be hoisted into system");
});

test("a depth-injection with role:system is still not hoisted", () => {
  const out = convert(history(), [
    { role: "system", content: "LORE", tag: "depth-injection", depth: 2 },
    { role: "system", content: "CARD", tag: "system-block" },
  ]);
  assert.deepEqual(out.system, [{ type: "text", text: "CARD" }]);
});

// ---------------------------------------------------------------------------
// GUARD 2 — teleport to bottom. THIS is the guard the tag contract does not provide.
// ---------------------------------------------------------------------------

test("a depth-injection does NOT collapse onto the last message", () => {
  const out = convert(history(), [inject(3)]);
  const messages = out.messages as OutMessage[];
  const last = messages[messages.length - 1];
  assert.ok(
    !texts(last).includes("LORE"),
    "depth 3 must not land on the final turn — that is teleport-to-bottom"
  );
});

test("depth counts messages from the end", () => {
  // history(): [u1, a1, u2, a2, u3]. depth 1 -> the message one from the end -> a2.
  // a2 is an assistant turn, so the injection redirects to the nearest preceding user
  // turn, u2.
  const out = convert(history(), [inject(1)]);
  const messages = out.messages as OutMessage[];
  const carrier = messages.findIndex((m) => texts(m).includes("LORE"));
  assert.equal(messages[carrier].role, "user");
  assert.ok(texts(messages[carrier]).includes("u2"), "expected the injection on u2");
});

test("depth 0 targets the final turn", () => {
  const out = convert(history(), [inject(0)]);
  const messages = out.messages as OutMessage[];
  const last = messages[messages.length - 1];
  assert.ok(texts(last).includes("u3"));
  assert.ok(texts(last).includes("LORE"), "depth 0 lands on the final user turn");
});

test("two injections at different depths land on different messages", () => {
  const out = convert(history(), [inject(0, "SHALLOW"), inject(4, "DEEP")]);
  const messages = out.messages as OutMessage[];
  const shallow = messages.findIndex((m) => texts(m).includes("SHALLOW"));
  const deep = messages.findIndex((m) => texts(m).includes("DEEP"));
  assert.notEqual(shallow, deep, "different depths must not collapse to one message");
  assert.ok(deep < shallow, "the deeper injection sits earlier in the conversation");
});

// ---------------------------------------------------------------------------
// Assistant-turn redirect
// ---------------------------------------------------------------------------

test("an injection targeting an assistant turn moves to the nearest preceding user turn", () => {
  // depth 1 -> a2 (assistant) -> redirect to u2.
  const out = convert(history(), [inject(1)]);
  const messages = out.messages as OutMessage[];
  const assistantCarriers = messages.filter(
    (m) => m.role === "assistant" && texts(m).includes("LORE")
  );
  assert.equal(assistantCarriers.length, 0, "never put lorebook text in the model's own mouth");
});

test("when no preceding user turn exists, the injection goes to the first user turn", () => {
  const out = convert(
    [
      { role: "assistant", content: "greeting" },
      { role: "user", content: "u1" },
    ],
    [inject(1)]
  );
  const messages = out.messages as OutMessage[];
  const carrier = messages.find((m) => texts(m).includes("LORE"));
  assert.equal(carrier?.role, "user", "must land on a user turn, never an assistant one");
});

// ---------------------------------------------------------------------------
// Clamping and ordering
// ---------------------------------------------------------------------------

test("depth beyond history length clamps to the top of the history", () => {
  const out = convert(history(), [inject(99)]);
  const messages = out.messages as OutMessage[];
  const carrier = messages.findIndex((m) => texts(m).includes("LORE"));
  assert.equal(carrier, 0, "an over-deep injection clamps to the first message");
  assert.equal(messages[0].role, "user");
});

test("injections at the same depth keep registration order", () => {
  const out = convert(history(), [inject(0, "FIRST"), inject(0, "SECOND")]);
  const messages = out.messages as OutMessage[];
  const last = messages[messages.length - 1];
  const t = texts(last);
  assert.ok(t.indexOf("FIRST") < t.indexOf("SECOND"), "same depth keeps registration order");
});

test("the injection is appended after the message's own content", () => {
  const out = convert(history(), [inject(0)]);
  const messages = out.messages as OutMessage[];
  const t = texts(messages[messages.length - 1]);
  assert.ok(t.indexOf("u3") < t.indexOf("LORE"), "the user's own text comes first");
});

test("an injection is appended as a block, never string-concatenated", () => {
  const out = convert([{ role: "user", content: [{ type: "text", text: "u1" }] }], [inject(0)]);
  const messages = out.messages as OutMessage[];
  assert.deepEqual(messages[0].content, [
    { type: "text", text: "u1" },
    { type: "text", text: "LORE" },
  ]);
});

// ---------------------------------------------------------------------------
// Multi-injection collision — NOT required by the brief, added because the brief's own
// mutation table flags this guard as possibly weak: "orderInjections replaced with the raw
// array ... verify; if it still passes, the ordering guard is weak — say so in your
// report." Tracing showed the 12 tests above do not actually distinguish orderInjections()
// from a no-op passthrough, because the only same-depth case they exercise (depth 0 vs
// depth 0) has registration order equal to sorted order by construction, and different-depth
// cases never land two injections on the SAME final message where relative order would be
// observable. This test constructs that exact collision: a shallow injection that redirects
// off an assistant turn, and a deeper injection that lands on the same user turn directly,
// registered in the OPPOSITE order from what depth-ordering requires.
// ---------------------------------------------------------------------------

test("deeper depth still sorts before a shallower one even when registered afterward, on a shared target message", () => {
  // history(): [u1, a1, u2, a2, u3]. depth 1 -> a2 (assistant) -> redirects to u2.
  // depth 2 -> u2 directly. Registered SHALLOW (depth 1) first, DEEP (depth 2) second —
  // the opposite of depth order — so only a real depth-sort (not registration order, and
  // not a no-op array) puts DEEP before SHALLOW in the output.
  const out = convert(history(), [inject(1, "SHALLOW_REDIRECT"), inject(2, "DEEP_DIRECT")]);
  const messages = out.messages as OutMessage[];
  const u2 = messages[2];
  assert.equal(messages[2].role, "user");
  const t = texts(u2);
  assert.ok(
    t.indexOf("DEEP_DIRECT") < t.indexOf("SHALLOW_REDIRECT"),
    "deeper depth (2) must precede shallower depth (1) on their shared target message, " +
      "regardless of registration order"
  );
});

// ---------------------------------------------------------------------------
// Clamp-removal edge case — also NOT required by the brief. Tracing the mutation table's
// "clamp removed — targetIdx allowed negative" mutant showed the required test ("depth
// beyond history length clamps to the top") does not actually distinguish clamped from
// unclamped behavior for the history() fixture used throughout this file: history() opens
// on a user turn, so both the clamp (targetIdx -> 0) and the assistant-redirect fallback
// (walk fails, findIndex(user) -> 0) independently land on index 0 — the clamp is masked.
// The clamp only becomes observable when NO user turn exists anywhere in the conversation
// AND depth exceeds history length: then the fallback's final line, `idx = targetIdx`, uses
// the unclamped (deeply negative) targetIdx instead of a valid index, and
// `out[idx].content` throws. This test locks in the non-crashing behavior.
// ---------------------------------------------------------------------------

test("an all-assistant history with an over-deep injection does not crash", () => {
  const out = convert(
    [
      { role: "assistant", content: "a1" },
      { role: "assistant", content: "a2" },
    ],
    [inject(99)]
  );
  const messages = out.messages as OutMessage[];
  const carrier = messages.findIndex((m) => texts(m).includes("LORE"));
  assert.ok(carrier >= 0, "the injection must land somewhere, not throw or vanish");
});
