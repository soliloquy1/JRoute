// tests/unit/mcp-client-builtin-transport.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-client-builtin-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createMcpServer, listMcpServers } = await import("../../src/lib/db/mcpServers.ts");
const { connectMcpClient } = await import("../../src/lib/mcp/client.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM mcp_servers").run();
});

test("the migration-seeded builtin server connects via connectMcpClient and lists its tools", async () => {
  createMcpServer("JRoute Web Search", "builtin", "", {
    toolAllowlist: "web_search,web_fetch",
  });
  const server = listMcpServers().find((s) => s.transport === "builtin")!;
  const client = await connectMcpClient(server);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["web_fetch", "web_search"]);
  await client.close();
});

test("a builtin transport connection does not touch the network (no target url required)", async () => {
  const id = createMcpServer("no target", "builtin", "");
  const server = listMcpServers().find((s) => s.id === id)!;
  assert.equal(server.target, "");
  const client = await connectMcpClient(server);
  await client.close();
});
