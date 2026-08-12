// tests/unit/mcp-client.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-mcp-client-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createMcpServer, confirmMcpServer, getMcpServer } =
  await import("../../src/lib/db/mcpServers.ts");
const { connectMcpClient } = await import("../../src/lib/mcp/client.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("connecting a stdio server without JROUTE_ALLOW_REMOTE_STDIO=1 is rejected", async () => {
  delete process.env.JROUTE_ALLOW_REMOTE_STDIO;
  const id = createMcpServer("local-tool", "stdio", "node ./tool.js");
  const server = getMcpServer(id)!;
  await assert.rejects(() => connectMcpClient(server), /JROUTE_ALLOW_REMOTE_STDIO/);
});

test("connecting a stdio server with the env flag set but no operator confirmation is still rejected", async () => {
  process.env.JROUTE_ALLOW_REMOTE_STDIO = "1";
  try {
    const id = createMcpServer("local-tool-2", "stdio", "node ./tool2.js");
    const server = getMcpServer(id)!;
    await assert.rejects(() => connectMcpClient(server), /confirm/i);
  } finally {
    delete process.env.JROUTE_ALLOW_REMOTE_STDIO;
  }
});

test("a stdio server with both the env flag set and operator confirmation is allowed to attempt connection", async () => {
  process.env.JROUTE_ALLOW_REMOTE_STDIO = "1";
  try {
    const id = createMcpServer("local-tool-3", "stdio", "node --version");
    confirmMcpServer(id);
    const server = getMcpServer(id)!;
    // "node --version" is not a real MCP server, so the actual MCP handshake will fail —
    // that's fine, this test only proves the AUTHORIZATION gate let it past both checks and
    // attempted a real connection, not that the connection succeeded.
    try {
      await connectMcpClient(server);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert.doesNotMatch(message, /JROUTE_ALLOW_REMOTE_STDIO/);
      assert.doesNotMatch(message, /confirm/i);
    }
  } finally {
    delete process.env.JROUTE_ALLOW_REMOTE_STDIO;
  }
});

test("an unknown transport value throws a descriptive error, never silently returns", async () => {
  const id = createMcpServer("bad", "http", "https://example.com/mcp");
  const server = getMcpServer(id)!;
  const corrupted = { ...server, transport: "carrier-pigeon" } as unknown as typeof server;
  await assert.rejects(() => connectMcpClient(corrupted), /transport/i);
});
