// tests/unit/prompts-macros.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { substituteMacros } from "../../src/lib/prompts/macros.ts";

test("substitutes {{char}} and {{user}}", () => {
  const out = substituteMacros("Write {{char}}'s reply to {{user}}.", {
    char: "Izumi",
    user: "Anon",
  });
  assert.equal(out, "Write Izumi's reply to Anon.");
});

test("substitutes {{newline}} with an actual newline", () => {
  const out = substituteMacros("line1{{newline}}line2", { char: "", user: "" });
  assert.equal(out, "line1\nline2");
});

test("leaves unsupported macros unresolved, passed through literally", () => {
  const out = substituteMacros("Roll: {{roll:1d20}}, time: {{time}}", { char: "", user: "" });
  assert.equal(out, "Roll: {{roll:1d20}}, time: {{time}}");
});

test("handles repeated occurrences of the same macro", () => {
  const out = substituteMacros("{{char}} looks at {{char}}.", { char: "Izumi", user: "" });
  assert.equal(out, "Izumi looks at Izumi.");
});
