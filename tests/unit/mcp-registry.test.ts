// tests/unit/mcp-registry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterToolsForAllowlist } from "../../src/lib/mcp/registry.ts";
import type { OpenAiToolDef } from "../../src/lib/mcp/registry.ts";

const searchTool: OpenAiToolDef = {
  type: "function",
  function: { name: "search", description: "Search the web", parameters: {} },
};
const weatherTool: OpenAiToolDef = {
  type: "function",
  function: { name: "weather", description: "Get weather", parameters: {} },
};

test("a null allowlist means no tools are exposed — allowlist is opt-in, not opt-out", () => {
  assert.deepEqual(filterToolsForAllowlist([searchTool, weatherTool], null), []);
});

test("an empty-string allowlist means no tools are exposed", () => {
  assert.deepEqual(filterToolsForAllowlist([searchTool, weatherTool], ""), []);
});

test("a comma-separated allowlist keeps only matching tool names, in the tools array's original order", () => {
  const out = filterToolsForAllowlist([searchTool, weatherTool], "weather,search");
  assert.deepEqual(
    out.map((t) => t.function.name),
    ["search", "weather"]
  );
});

test("allowlist entries are trimmed of whitespace", () => {
  const out = filterToolsForAllowlist([searchTool, weatherTool], " search , weather ");
  assert.equal(out.length, 2);
});

test("an allowlist naming a tool the server doesn't have is silently ignored, not an error", () => {
  const out = filterToolsForAllowlist([searchTool], "search,nonexistent");
  assert.deepEqual(
    out.map((t) => t.function.name),
    ["search"]
  );
});

test("discoverTools maps MCP tool shape (name, description, inputSchema) to OpenAI function-tool shape", async () => {
  const stubClient = {
    listTools: async () => ({
      tools: [
        {
          name: "search",
          description: "Search the web",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        },
      ],
    }),
  };
  const { discoverTools } = await import("../../src/lib/mcp/registry.ts");
  const out = await discoverTools(stubClient as never);
  assert.deepEqual(out, [
    {
      type: "function",
      function: {
        name: "search",
        description: "Search the web",
        parameters: { type: "object", properties: { query: { type: "string" } } },
      },
    },
  ]);
});

test("discoverTools defaults a missing description to an empty string, never undefined", async () => {
  const stubClient = {
    listTools: async () => ({
      tools: [{ name: "no-description-tool", inputSchema: {} }],
    }),
  };
  const { discoverTools } = await import("../../src/lib/mcp/registry.ts");
  const out = await discoverTools(stubClient as never);
  assert.equal(out[0].function.description, "");
});
