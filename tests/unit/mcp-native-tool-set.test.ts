import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-native-tool-set-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createMcpServer } = await import("../../src/lib/db/mcpServers.ts");
const { getNativeToolSet, clearNativeToolSetCacheForTests } =
  await import("../../src/lib/mcp/nativeToolSet.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM mcp_servers").run();
  clearNativeToolSetCacheForTests();
});

test("no enabled servers with a tool allowlist produces an empty tool set", async () => {
  const { tools } = await getNativeToolSet();
  assert.deepEqual(tools, []);
});

test("a disabled server is not advertised even with an allowlist", async () => {
  createMcpServer("x", "builtin", "", { enabled: false, toolAllowlist: "web_search" });
  const { tools } = await getNativeToolSet();
  assert.deepEqual(tools, []);
});

test("advertises the builtin search server's tools when enabled with an allowlist", async () => {
  createMcpServer("JRoute Web Search", "builtin", "", {
    enabled: true,
    toolAllowlist: "web_search,web_fetch",
  });
  const { tools, resolveServerForTool } = await getNativeToolSet();
  assert.deepEqual(tools.map((t) => t.function.name).sort(), ["web_fetch", "web_search"]);
  const server = resolveServerForTool("web_search");
  assert.equal(server?.name, "JRoute Web Search");
});

test("a tool outside the server's allowlist is not advertised", async () => {
  createMcpServer("JRoute Web Search", "builtin", "", {
    enabled: true,
    toolAllowlist: "web_search",
  });
  const { tools, resolveServerForTool } = await getNativeToolSet();
  assert.deepEqual(
    tools.map((t) => t.function.name),
    ["web_search"]
  );
  assert.equal(resolveServerForTool("web_fetch"), null);
});

test("tool-name collision: the lower server id wins, deterministically", async () => {
  const firstId = createMcpServer("first", "builtin", "", {
    enabled: true,
    toolAllowlist: "web_search",
  });
  createMcpServer("second-duplicate", "builtin", "", {
    enabled: true,
    toolAllowlist: "web_search",
  });
  const { tools, resolveServerForTool } = await getNativeToolSet();
  assert.equal(tools.filter((t) => t.function.name === "web_search").length, 1);
  const server = resolveServerForTool("web_search");
  assert.equal(server?.id, firstId);
});

test("resolveServerForTool returns null for an unknown tool name", async () => {
  const { resolveServerForTool } = await getNativeToolSet();
  assert.equal(resolveServerForTool("nonexistent"), null);
});

test("caches the resolved set — a second call within the TTL does not re-discover", async () => {
  createMcpServer("x", "builtin", "", { enabled: true, toolAllowlist: "web_search" });
  const first = await getNativeToolSet();
  // Delete the server row directly (bypassing the cache) — if the second call re-discovers
  // from the DB, it would see zero servers and return empty tools. If it serves from cache,
  // it still returns the tools from the first call.
  getDb().prepare("DELETE FROM mcp_servers").run();
  const second = await getNativeToolSet();
  assert.deepEqual(first.tools, second.tools);
  assert.ok(
    second.tools.length > 0,
    "expected the cached (non-empty) result, not a fresh empty discovery"
  );
});

test("a fresh discovery after the cache is cleared reflects the new DB state", async () => {
  createMcpServer("x", "builtin", "", { enabled: true, toolAllowlist: "web_search" });
  const first = await getNativeToolSet();
  assert.equal(first.tools.length, 1);
  getDb().prepare("DELETE FROM mcp_servers").run();
  clearNativeToolSetCacheForTests();
  const second = await getNativeToolSet();
  assert.deepEqual(second.tools, [], "expected a real re-discovery once the cache expired");
});

test("a server that fails discovery is skipped, not fatal — healthy servers still advertise", async () => {
  // An http-transport server pointed at an unroutable target fails to connect; its tools are
  // omitted while the builtin server behind it still contributes (per-source isolation).
  createMcpServer("broken", "http", "http://127.0.0.1:1/mcp", {
    enabled: true,
    toolAllowlist: "whatever",
  });
  createMcpServer("JRoute Web Search", "builtin", "", {
    enabled: true,
    toolAllowlist: "web_search",
  });
  const { tools, resolveServerForTool } = await getNativeToolSet();
  assert.deepEqual(
    tools.map((t) => t.function.name),
    ["web_search"]
  );
  assert.equal(resolveServerForTool("web_search")?.name, "JRoute Web Search");
});
