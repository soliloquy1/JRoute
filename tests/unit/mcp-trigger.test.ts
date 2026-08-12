// tests/unit/mcp-trigger.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-mcp-trigger-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createMcpServer } = await import("../../src/lib/db/mcpServers.ts");
const { runTriggerMode } = await import("../../src/lib/mcp/trigger.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM mcp_servers").run();
});

test("no enabled MCP servers with a triggerPattern produces no blocks", async () => {
  const blocks = await runTriggerMode({ lastUserMessage: "search for cat videos" });
  assert.deepEqual(blocks, []);
});

test("a disabled server with a matching pattern is skipped", async () => {
  createMcpServer("search", "http", "https://example.com/mcp", {
    enabled: false,
    triggerPattern: "\\bsearch\\b",
    toolAllowlist: "search",
  });
  const blocks = await runTriggerMode({ lastUserMessage: "search for cat videos" });
  assert.deepEqual(blocks, []);
});

test("a server whose triggerPattern is null never fires, even if enabled", async () => {
  createMcpServer("search", "http", "https://example.com/mcp", { toolAllowlist: "search" });
  const blocks = await runTriggerMode({ lastUserMessage: "search for cat videos" });
  assert.deepEqual(blocks, []);
});

test("a server whose pattern does not match the last user message produces no blocks", async () => {
  createMcpServer("search", "http", "https://example.com/mcp", {
    triggerPattern: "\\bweather\\b",
    toolAllowlist: "search",
  });
  const blocks = await runTriggerMode({ lastUserMessage: "search for cat videos" });
  assert.deepEqual(blocks, []);
});

test("an unsafe (catastrophic-backtracking) triggerPattern is rejected before use, never matches, never hangs", async () => {
  createMcpServer("bad-pattern", "http", "https://example.com/mcp", {
    triggerPattern: "(a+)+$",
    toolAllowlist: "search",
  });
  const blocks = await runTriggerMode({ lastUserMessage: "a".repeat(30) + "!" });
  assert.deepEqual(blocks, []);
});

test("a matching pattern whose server connection fails produces no blocks, never throws out of runTriggerMode", async () => {
  createMcpServer("unreachable", "http", "https://127.0.0.1:1/mcp", {
    triggerPattern: "\\bsearch\\b",
    toolAllowlist: "search",
  });
  // Must not throw — connection/tool-call failures degrade to "no block for this trigger",
  // matching the lorebook runner's (Plan 5, src/lib/lorebooks/runner.ts) precedent of
  // isolating one bad source from failing the whole request.
  const blocks = await runTriggerMode({ lastUserMessage: "search for cat videos" });
  assert.deepEqual(blocks, []);
});
