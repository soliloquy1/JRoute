// tests/unit/convert-gemini-request.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiConverter } from "../../jroute/convert/gemini/request.ts";
import type { ConvertRequestParams } from "../../jroute/convert/types.ts";

function params(over: Partial<ConvertRequestParams>): ConvertRequestParams {
  return {
    model: "gemini-2.0-flash",
    maxTokens: 8192,
    body: { messages: [] },
    blocks: [],
    ...over,
  };
}

test("maps user/assistant messages to gemini user/model contents with parts", () => {
  const out = geminiConverter.convertRequest(
    params({
      body: {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello there" },
          { role: "user", content: "how are you" },
        ],
      },
    })
  );
  assert.deepEqual(out.contents, [
    { role: "user", parts: [{ text: "hi" }] },
    { role: "model", parts: [{ text: "hello there" }] },
    { role: "user", parts: [{ text: "how are you" }] },
  ]);
  assert.equal(out.model, undefined, "model belongs in the URL, never the body");
});

test("hoists system blocks into systemInstruction, not contents", () => {
  const out = geminiConverter.convertRequest(
    params({
      blocks: [
        { role: "system", content: "You are Aria.", tag: "system-block" },
        { role: "system", content: "Stay in character.", tag: "system-block" },
      ],
      body: { messages: [{ role: "user", content: "hi" }] },
    })
  );
  assert.deepEqual(out.systemInstruction, {
    parts: [{ text: "You are Aria." }, { text: "Stay in character." }],
  });
  // No system role leaks into contents.
  const contents = out.contents as Array<{ role: string }>;
  assert.ok(contents.every((c) => c.role === "user" || c.role === "model"));
});

test("a client role:system message is hoisted into systemInstruction, not left in contents", () => {
  const out = geminiConverter.convertRequest(
    params({
      body: {
        messages: [
          { role: "system", content: "client system text" },
          { role: "user", content: "hi" },
        ],
      },
    })
  );
  assert.deepEqual(out.systemInstruction, { parts: [{ text: "client system text" }] });
  assert.deepEqual(out.contents, [{ role: "user", parts: [{ text: "hi" }] }]);
});

test("maps sampling params into generationConfig with gemini names", () => {
  const out = geminiConverter.convertRequest(
    params({
      body: {
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        max_tokens: 500,
        stop: ["END"],
      },
    })
  );
  assert.deepEqual(out.generationConfig, {
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    maxOutputTokens: 500,
    stopSequences: ["END"],
  });
});

test("maxOutputTokens clamps to the model ceiling and defaults to it when unset", () => {
  const overCeiling = geminiConverter.convertRequest(
    params({
      maxTokens: 100,
      body: { messages: [{ role: "user", content: "hi" }], max_tokens: 999999 },
    })
  );
  assert.equal((overCeiling.generationConfig as { maxOutputTokens: number }).maxOutputTokens, 100);

  const unset = geminiConverter.convertRequest(
    params({ maxTokens: 100, body: { messages: [{ role: "user", content: "hi" }] } })
  );
  assert.equal((unset.generationConfig as { maxOutputTokens: number }).maxOutputTokens, 100);
});

test("sets stream flag is NOT in the body — streaming is a URL concern", () => {
  const out = geminiConverter.convertRequest(
    params({ body: { messages: [{ role: "user", content: "hi" }], stream: true } })
  );
  assert.equal(
    out.stream,
    undefined,
    "gemini streaming is selected by the :streamGenerateContent URL, not a body field"
  );
});

test("a string stop maps to a single-element stopSequences array", () => {
  const out = geminiConverter.convertRequest(
    params({ body: { messages: [{ role: "user", content: "hi" }], stop: "STOP" } })
  );
  assert.deepEqual((out.generationConfig as { stopSequences: string[] }).stopSequences, ["STOP"]);
});
