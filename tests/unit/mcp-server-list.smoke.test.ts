// tests/unit/mcp-server-list.smoke.test.ts
// Smoke test: ServerList renders an enable/disable switch per server, reflecting its real
// `enabled` state — the dashboard's only way to flip a seeded-disabled server (e.g. the
// built-in "JRoute Web Search" MCP server) on, since PATCH /api/mcp-servers/:id already
// supports `enabled` but no UI control ever called it.
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { McpServer } from "../../src/lib/db/types.ts";

register("./_stubs/navHooks.mjs", import.meta.url);

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 1,
    name: "JRoute Web Search",
    transport: "builtin",
    target: "",
    enabled: false,
    toolAllowlist: "web_search,web_fetch",
    triggerPattern: null,
    confirmedAt: null,
    ...overrides,
  };
}

test("a disabled server renders an unchecked enable switch", async () => {
  const { ServerList } = await import("../../src/components/dashboard/mcp/ServerList.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ServerList, { servers: [server({ enabled: false })] })
  );
  assert.ok(html.includes('role="switch"'), "expected a switch control to render");
  assert.ok(
    html.includes('aria-checked="false"'),
    "expected aria-checked=false for a disabled server"
  );
});

test("an enabled server renders a checked enable switch", async () => {
  const { ServerList } = await import("../../src/components/dashboard/mcp/ServerList.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ServerList, { servers: [server({ id: 2, enabled: true })] })
  );
  assert.ok(html.includes('role="switch"'), "expected a switch control to render");
  assert.ok(
    html.includes('aria-checked="true"'),
    "expected aria-checked=true for an enabled server"
  );
});
