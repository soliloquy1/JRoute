// tests/unit/convert-gemini-response.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { convertResponse, mapFinishReason } from "../../jroute/convert/gemini/response.ts";
import { mapMessagesToGemini } from "../../jroute/convert/gemini/request.ts";

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

// --- Native MCP tool-calling mode (design spec §8.1) ----------------------------------------
// Field names verified against the current Gemini docs: a tool invocation is a content part
// `{functionCall:{name,args}}`; `args` is an ALREADY-PARSED object (no JSON.parse needed); and
// the part may carry a sibling `thoughtSignature` that must be echoed back next turn.

test("a functionCall-only response produces tool_calls with content: null", () => {
  const out = convertResponse(
    {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ functionCall: { name: "web_search", args: { query: "cats" } } }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    },
    "gemini-3-flash"
  ) as { choices: Array<{ message: { content: unknown; tool_calls?: unknown } }> };
  const message = out.choices[0].message;
  assert.equal(message.content, null);
  assert.deepEqual(message.tool_calls, [
    {
      id: (message.tool_calls as Array<{ id: string }>)[0].id,
      type: "function",
      function: { name: "web_search", arguments: '{"query":"cats"}' },
    },
  ]);
});

test("a functionCall part with a thoughtSignature carries it into _geminiThoughtSignature", () => {
  const out = convertResponse(
    {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: { name: "web_search", args: {} },
                thoughtSignature: "opaque-sig-xyz",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {},
    },
    "gemini-3-flash"
  ) as {
    choices: Array<{ message: { tool_calls?: Array<{ _geminiThoughtSignature?: string }> } }>;
  };
  assert.equal(out.choices[0].message.tool_calls?.[0]._geminiThoughtSignature, "opaque-sig-xyz");
});

test("a text-only response is unaffected — no tool_calls field at all", () => {
  const out = convertResponse(
    {
      candidates: [{ content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP" }],
      usageMetadata: {},
    },
    "gemini-3-flash"
  ) as { choices: Array<{ message: { tool_calls?: unknown } }> };
  assert.equal("tool_calls" in out.choices[0].message, false);
});

test("thought signature round-trips: response -> tool_call -> next request's model part", () => {
  // 1. Model emits a functionCall with a thought signature.
  const resp = convertResponse(
    {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: { name: "web_search", args: { q: "x" } },
                thoughtSignature: "sig-ABC",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {},
    },
    "gemini-3-flash"
  ) as { choices: Array<{ message: { tool_calls: Array<Record<string, unknown>> } }> };

  // 2. Next turn's history carries that tool_call (with the captured signature).
  const history = [
    { role: "user", content: "search" },
    { role: "assistant", content: null, tool_calls: resp.choices[0].message.tool_calls },
    {
      role: "tool",
      name: "web_search",
      tool_call_id: resp.choices[0].message.tool_calls[0].id,
      content: "ok",
    },
  ];

  // 3. Request converter must re-attach the signature to the model functionCall part.
  const contents = mapMessagesToGemini(history as never);
  const modelPart = contents.find((c) => c.role === "model")?.parts[0] as {
    functionCall?: { name?: string };
    thoughtSignature?: string;
  };
  assert.equal(modelPart.functionCall?.name, "web_search");
  assert.equal(modelPart.thoughtSignature, "sig-ABC");
});
