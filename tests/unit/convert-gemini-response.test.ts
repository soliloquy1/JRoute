// tests/unit/convert-gemini-response.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { convertResponse, mapFinishReason } from "../../jroute/convert/gemini/response.ts";

test("converts candidates text into an OpenAI chat.completion", () => {
  const out = convertResponse(
    {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Hello " }, { text: "world" }] },
          finishReason: "STOP",
          index: 0,
        },
      ],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, totalTokenCount: 28 },
    },
    "gemini-2.0-flash"
  );
  assert.equal(out.object, "chat.completion");
  assert.equal(out.model, "gemini-2.0-flash");
  const choices = out.choices as Array<{ message: { content: string }; finish_reason: string }>;
  assert.equal(choices[0].message.content, "Hello world", "multiple parts concatenate");
  assert.equal(choices[0].finish_reason, "stop");
});

test("prompt_tokens is promptTokenCount ALONE — cachedContentTokenCount is already included", () => {
  const out = convertResponse(
    {
      candidates: [
        { content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP", index: 0 },
      ],
      // A cached request: promptTokenCount (200) is the TOTAL effective prompt and already
      // includes the 150 cached tokens. Summing would report 350 and bill the operator double.
      usageMetadata: {
        promptTokenCount: 200,
        cachedContentTokenCount: 150,
        candidatesTokenCount: 10,
        totalTokenCount: 210,
      },
    },
    "gemini-2.0-flash"
  );
  const usage = out.usage as {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  assert.equal(
    usage.prompt_tokens,
    200,
    "must NOT add cachedContentTokenCount — it is already inside promptTokenCount"
  );
  assert.equal(usage.completion_tokens, 10);
  assert.equal(usage.total_tokens, 210);
});

test("finishReason table maps every filter variant to content_filter", () => {
  for (const r of [
    "SAFETY",
    "RECITATION",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "IMAGE_SAFETY",
    "LANGUAGE",
  ]) {
    assert.equal(mapFinishReason(r), "content_filter", `${r} must be content_filter`);
  }
});

test("finishReason table maps stop-like and error variants correctly", () => {
  assert.equal(mapFinishReason("STOP"), "stop");
  assert.equal(mapFinishReason("MAX_TOKENS"), "length");
  assert.equal(mapFinishReason("MALFORMED_FUNCTION_CALL"), "stop");
  assert.equal(mapFinishReason("OTHER"), "stop");
  assert.equal(mapFinishReason("FINISH_REASON_UNSPECIFIED"), "stop");
  assert.equal(
    mapFinishReason("something-new-google-added"),
    "stop",
    "unknown degrades to stop, never throws"
  );
  assert.equal(mapFinishReason(null), "stop");
  assert.equal(mapFinishReason(undefined), "stop");
});

test("a candidate with no parts yields empty content, not a crash", () => {
  const out = convertResponse(
    {
      candidates: [{ content: { role: "model", parts: [] }, finishReason: "SAFETY", index: 0 }],
      usageMetadata: {},
    },
    "gemini-2.0-flash"
  );
  const choices = out.choices as Array<{ message: { content: string }; finish_reason: string }>;
  assert.equal(choices[0].message.content, "");
  assert.equal(choices[0].finish_reason, "content_filter");
});

test("missing usageMetadata yields zeroed usage, not undefined", () => {
  const out = convertResponse(
    {
      candidates: [
        { content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP", index: 0 },
      ],
    },
    "gemini-2.0-flash"
  );
  const usage = out.usage as {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  assert.deepEqual(usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
});
