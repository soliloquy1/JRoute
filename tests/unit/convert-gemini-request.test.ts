// tests/unit/convert-gemini-request.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geminiConverter,
  mapGeminiFunctionDeclarations,
  mapMessagesToGemini,
} from "../../jroute/convert/gemini/request.ts";
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

import { placeGeminiInjections, absorbLeadingModel } from "../../jroute/convert/gemini/request.ts";

test("depth-injection lands at depth N from the end, in the user turn's parts", () => {
  const contents = [
    { role: "user" as const, parts: [{ text: "u0" }] },
    { role: "model" as const, parts: [{ text: "m1" }] },
    { role: "user" as const, parts: [{ text: "u2" }] },
  ];
  const out = placeGeminiInjections(contents, [
    { role: "system", content: "LORE", tag: "depth-injection", depth: 2 },
  ]);
  // depth 2 from the end = index 0 (the u0 user turn). Injected into its parts, appended.
  assert.deepEqual(out[0].parts, [{ text: "u0" }, { text: "LORE" }]);
  // Other turns untouched; caller array not mutated.
  assert.deepEqual(contents[0].parts, [{ text: "u0" }], "input must not be mutated");
});

test("an injection targeting a model turn redirects to the nearest preceding user turn", () => {
  const contents = [
    { role: "user" as const, parts: [{ text: "u0" }] },
    { role: "model" as const, parts: [{ text: "m1" }] },
    { role: "user" as const, parts: [{ text: "u2" }] },
  ];
  // depth 1 from the end = index 1 (the model turn). Must redirect to index 0 (user), not sit on model.
  const out = placeGeminiInjections(contents, [
    { role: "system", content: "LORE", tag: "depth-injection", depth: 1 },
  ]);
  assert.deepEqual(out[1].parts, [{ text: "m1" }], "must NOT land in the model turn");
  assert.deepEqual(out[0].parts, [{ text: "u0" }, { text: "LORE" }]);
});

test("multiple injections order deeper-first, then registration order", () => {
  const contents = [
    { role: "user" as const, parts: [{ text: "u0" }] },
    { role: "model" as const, parts: [{ text: "m1" }] },
  ];
  const out = placeGeminiInjections(contents, [
    { role: "system", content: "A", tag: "depth-injection", depth: 0 },
    { role: "system", content: "B", tag: "depth-injection", depth: 1 },
  ]);
  // Both land in turn 0: B (depth 1) targets it directly; A (depth 0) targets the model turn
  // and redirects back to it. Two injections that land in DIFFERENT turns cannot distinguish
  // deeper-first from registration order (each gets its own slot), so this test forces both
  // into one turn: deeper-first means B is appended before A -> [u0, B, A], while plain
  // registration order would append A first -> [u0, A, B]. That difference is the guard.
  assert.deepEqual(out[0].parts, [{ text: "u0" }, { text: "B" }, { text: "A" }]);
  assert.deepEqual(out[1].parts, [{ text: "m1" }], "model turn untouched");
});

test("depth exceeding history clamps to the top user turn", () => {
  const contents = [{ role: "user" as const, parts: [{ text: "u0" }] }];
  const out = placeGeminiInjections(contents, [
    { role: "system", content: "LORE", tag: "depth-injection", depth: 99 },
  ]);
  assert.deepEqual(out[0].parts, [{ text: "u0" }, { text: "LORE" }]);
});

test("a leading model greeting is absorbed into systemInstruction (end-to-end)", () => {
  const out = geminiConverter.convertRequest(
    params({
      blocks: [{ role: "system", content: "You are Aria.", tag: "system-block" }],
      body: {
        messages: [
          { role: "assistant", content: "Hello, traveler." }, // the greeting
          { role: "user", content: "hi" },
        ],
      },
    })
  );
  const si = out.systemInstruction as { parts: Array<{ text: string }> };
  assert.deepEqual(si.parts, [{ text: "You are Aria." }, { text: "Hello, traveler." }]);
  assert.deepEqual(out.contents, [{ role: "user", parts: [{ text: "hi" }] }]);
});

test("absorbLeadingModel returns the absorbed text and the trimmed contents", () => {
  const { contents, absorbed } = absorbLeadingModel([
    { role: "model", parts: [{ text: "greeting" }] },
    { role: "user", parts: [{ text: "hi" }] },
  ]);
  assert.deepEqual(absorbed, ["greeting"]);
  assert.deepEqual(contents, [{ role: "user", parts: [{ text: "hi" }] }]);
});

test("empty-content messages are stripped end-to-end", () => {
  const out = geminiConverter.convertRequest(
    params({
      body: {
        messages: [
          { role: "user", content: "" }, // empty -> stripped
          { role: "user", content: "real" },
        ],
      },
    })
  );
  assert.deepEqual(out.contents, [{ role: "user", parts: [{ text: "real" }] }]);
});

test("maps frequency_penalty, presence_penalty, seed, and n onto generationConfig", () => {
  const out = geminiConverter.convertRequest(
    params({
      body: {
        messages: [],
        frequency_penalty: 0.4,
        presence_penalty: 0.2,
        seed: 12345,
        n: 2,
      },
    })
  );
  const cfg = out.generationConfig as Record<string, unknown>;
  assert.equal(cfg.frequencyPenalty, 0.4);
  assert.equal(cfg.presencePenalty, 0.2);
  assert.equal(cfg.seed, 12345);
  assert.equal(cfg.candidateCount, 2);
});

test("does not forward min_p, top_a, or repetition_penalty — no Gemini equivalent", () => {
  const out = geminiConverter.convertRequest(
    params({
      body: { messages: [], min_p: 0.05, top_a: 0.1, repetition_penalty: 1.1 },
    })
  );
  const cfg = out.generationConfig as Record<string, unknown>;
  assert.equal("minP" in cfg, false);
  assert.equal("topA" in cfg, false);
  assert.equal("repetitionPenalty" in cfg, false);
});

// --- Native MCP tool-calling mode (design spec §6.2) ----------------------------------------
// Field names verified against the current Gemini docs: tools use `functionDeclarations` with
// `{name, description, parameters}` (note: `parameters`, NOT Anthropic's `input_schema`), and
// the mode is forced via `toolConfig.functionCallingConfig.mode` = "AUTO".

test("mapGeminiFunctionDeclarations converts OpenAI fns to Gemini functionDeclarations shape", () => {
  const tools = [
    {
      type: "function" as const,
      function: {
        name: "web_search",
        description: "Search the web",
        parameters: { type: "object" },
      },
    },
  ];
  assert.deepEqual(mapGeminiFunctionDeclarations(tools), [
    { name: "web_search", description: "Search the web", parameters: { type: "object" } },
  ]);
});

test("convertRequest sets functionDeclarations and forces AUTO mode when body.tools present", () => {
  const out = geminiConverter.convertRequest(
    params({
      body: {
        messages: [{ role: "user", content: "hi" }],
        // client-supplied tool_choice must be IGNORED, always forced to AUTO
        tools: [{ type: "function", function: { name: "t", description: "d", parameters: {} } }],
        tool_choice: "none",
      },
    })
  );
  assert.deepEqual(out.tools, [
    { functionDeclarations: [{ name: "t", description: "d", parameters: {} }] },
  ]);
  assert.deepEqual(out.toolConfig, { functionCallingConfig: { mode: "AUTO" } });
});

test("convertRequest omits tools/toolConfig entirely when body.tools is absent", () => {
  const out = geminiConverter.convertRequest(
    params({ body: { messages: [{ role: "user", content: "hi" }] } })
  );
  assert.equal("tools" in out, false);
  assert.equal("toolConfig" in out, false);
});

test("an assistant message with tool_calls maps to a model part with functionCall, parsed args", () => {
  const contents = mapMessagesToGemini([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "1",
          type: "function",
          function: { name: "web_search", arguments: '{"query":"cats"}' },
        },
      ],
    },
  ] as never);
  assert.equal(contents.length, 1);
  assert.equal(contents[0].role, "model");
  assert.deepEqual(contents[0].parts, [
    { functionCall: { name: "web_search", args: { query: "cats" } } },
  ]);
});

test("consecutive tool-role messages merge into ONE user content with multiple functionResponse parts", () => {
  const contents = mapMessagesToGemini([
    { role: "user", content: "search two things" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } },
        { id: "call_2", type: "function", function: { name: "web_search", arguments: "{}" } },
      ],
    },
    { role: "tool", name: "web_search", tool_call_id: "call_1", content: "result one" },
    { role: "tool", name: "web_search", tool_call_id: "call_2", content: "result two" },
  ] as never);
  // user, model(functionCall x2), ONE merged user(functionResponse x2)
  assert.equal(contents.length, 3);
  assert.equal(contents[2].role, "user");
  assert.deepEqual(contents[2].parts, [
    { functionResponse: { name: "web_search", response: { result: "result one" } } },
    { functionResponse: { name: "web_search", response: { result: "result two" } } },
  ]);
});

test("convertRequest itself routes tool-role messages through the merge", () => {
  const out = geminiConverter.convertRequest(
    params({
      body: {
        messages: [
          { role: "user", content: "search two things" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } },
              { id: "call_2", type: "function", function: { name: "web_search", arguments: "{}" } },
            ],
          },
          { role: "tool", name: "web_search", tool_call_id: "call_1", content: "result one" },
          { role: "tool", name: "web_search", tool_call_id: "call_2", content: "result two" },
        ],
      },
    })
  );
  const contents = out.contents as Array<{ role: string; parts: unknown[] }>;
  assert.equal(contents.length, 3);
  assert.deepEqual(contents[1].parts, [
    { functionCall: { name: "web_search", args: {} } },
    { functionCall: { name: "web_search", args: {} } },
  ]);
  assert.deepEqual(contents[2].parts, [
    { functionResponse: { name: "web_search", response: { result: "result one" } } },
    { functionResponse: { name: "web_search", response: { result: "result two" } } },
  ]);
});
