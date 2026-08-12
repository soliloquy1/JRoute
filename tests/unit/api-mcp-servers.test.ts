// tests/unit/api-mcp-servers.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { getMcpServer } = await import("../../src/lib/db/mcpServers.ts");
const servers = await import("../../src/app/api/mcp-servers/route.ts");
const serverById = await import("../../src/app/api/mcp-servers/[id]/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = { cookie: `jroute_session=${token}`, "content-type": "application/json" };

test("POST /api/mcp-servers without a session is 401", async () => {
  const res = await servers.POST(
    new Request("https://x/api/mcp-servers", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
});

test("POST /api/mcp-servers creates a server", async () => {
  const res = await servers.POST(
    new Request("https://x/api/mcp-servers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "websearch",
        transport: "http",
        target: "https://mcp.example.com",
      }),
    })
  );
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: number };
  assert.equal(getMcpServer(id)?.name, "websearch");
  assert.equal(getMcpServer(id)?.confirmedAt, null);
});

test("POST /api/mcp-servers with an invalid transport is 400", async () => {
  const res = await servers.POST(
    new Request("https://x/api/mcp-servers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "x", transport: "carrier-pigeon", target: "x" }),
    })
  );
  assert.equal(res.status, 400);
});

test("PATCH /api/mcp-servers/:id updates the tool allowlist", async () => {
  const res = await servers.POST(
    new Request("https://x/api/mcp-servers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "a", transport: "http", target: "https://a.example.com" }),
    })
  );
  const { id } = (await res.json()) as { id: number };
  const patchRes = await serverById.PATCH(
    new Request(`https://x/api/mcp-servers/${id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ toolAllowlist: "search,fetch" }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(patchRes.status, 200);
  assert.equal(getMcpServer(id)?.toolAllowlist, "search,fetch");
});

test("DELETE /api/mcp-servers/:id removes it", async () => {
  const res = await servers.POST(
    new Request("https://x/api/mcp-servers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "b", transport: "sse", target: "https://b.example.com" }),
    })
  );
  const { id } = (await res.json()) as { id: number };
  const delRes = await serverById.DELETE(
    new Request(`https://x/api/mcp-servers/${id}`, { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(delRes.status, 200);
  assert.equal(getMcpServer(id), null);
});
