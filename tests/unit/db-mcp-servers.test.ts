// tests/unit/db-mcp-servers.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const {
  createMcpServer,
  getMcpServer,
  listMcpServers,
  updateMcpServer,
  confirmMcpServer,
  deleteMcpServer,
} = await import("../../src/lib/db/mcpServers.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM mcp_servers").run();
});

test("createMcpServer defaults to enabled and unconfirmed", () => {
  const id = createMcpServer("websearch", "http", "https://mcp.example.com");
  const s = getMcpServer(id);
  assert.equal(s?.enabled, true);
  assert.equal(s?.confirmedAt, null);
  assert.equal(s?.toolAllowlist, null);
});

test("an invalid transport is rejected by the CHECK constraint", () => {
  assert.throws(() => {
    getDb()
      .prepare("INSERT INTO mcp_servers (name, transport, target) VALUES (?, ?, ?)")
      .run("bad", "carrier-pigeon", "x");
  }, /CHECK constraint failed/);
});

test("listMcpServers returns every row", () => {
  createMcpServer("a", "http", "https://a");
  createMcpServer("b", "stdio", "npx some-mcp-server");
  assert.equal(listMcpServers().length, 2);
});

test("updateMcpServer can set the tool allowlist", () => {
  const id = createMcpServer("a", "http", "https://a");
  updateMcpServer(id, { toolAllowlist: JSON.stringify(["search"]) });
  assert.equal(getMcpServer(id)?.toolAllowlist, JSON.stringify(["search"]));
});

test("confirmMcpServer stamps confirmedAt and is idempotent", () => {
  const id = createMcpServer("a", "stdio", "npx x");
  confirmMcpServer(id, 12345);
  assert.equal(getMcpServer(id)?.confirmedAt, 12345);
  confirmMcpServer(id, 99999);
  assert.equal(
    getMcpServer(id)?.confirmedAt,
    99999,
    "re-confirming updates the timestamp, not rejected"
  );
});

test("deleteMcpServer removes the row", () => {
  const id = createMcpServer("a", "http", "https://a");
  deleteMcpServer(id);
  assert.equal(getMcpServer(id), null);
});

test("createMcpServer accepts and persists a triggerPattern, defaulting to null", () => {
  const withPattern = createMcpServer("search", "http", "https://example.com/mcp", {
    triggerPattern: "\\bsearch for\\b",
  });
  const server = getMcpServer(withPattern)!;
  assert.equal(server.triggerPattern, "\\bsearch for\\b");

  const withoutPattern = createMcpServer("other", "http", "https://example.com/mcp2");
  assert.equal(getMcpServer(withoutPattern)!.triggerPattern, null);
});

test("updateMcpServer can set and clear triggerPattern", () => {
  const id = createMcpServer("search", "http", "https://example.com/mcp");
  updateMcpServer(id, { triggerPattern: "\\bweather\\b" });
  assert.equal(getMcpServer(id)!.triggerPattern, "\\bweather\\b");
  updateMcpServer(id, { triggerPattern: null });
  assert.equal(getMcpServer(id)!.triggerPattern, null);
});
