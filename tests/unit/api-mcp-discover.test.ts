// tests/unit/api-mcp-discover.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { createMcpServer } = await import("../../src/lib/db/mcpServers.ts");
const discover = await import("../../src/app/api/mcp-servers/[id]/discover/route.ts");
const confirm = await import("../../src/app/api/mcp-servers/[id]/confirm/route.ts");
const testInvoke = await import("../../src/app/api/mcp-servers/[id]/test-invoke/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = { cookie: `jroute_session=${token}`, "content-type": "application/json" };

test("POST discover without a session is 401", async () => {
  const res = await discover.POST(
    new Request("https://x/api/mcp-servers/1/discover", { method: "POST" }),
    { params: Promise.resolve({ id: "1" }) }
  );
  assert.equal(res.status, 401);
});

test("POST discover on a missing server is 404", async () => {
  const res = await discover.POST(
    new Request("https://x/api/mcp-servers/999999/discover", {
      method: "POST",
      headers: authHeaders,
    }),
    { params: Promise.resolve({ id: "999999" }) }
  );
  assert.equal(res.status, 404);
});

test("POST discover on an unconfirmed stdio server is rejected without spawning", async () => {
  // Plan 6's assertStdioAuthorized checks JROUTE_ALLOW_REMOTE_STDIO BEFORE confirmedAt
  // (src/lib/mcp/client.ts), so the /confirm/i rejection message is only reachable with
  // the env opt-in set — same setup Plan 6's own mcp-client.test.ts uses for this path.
  process.env.JROUTE_ALLOW_REMOTE_STDIO = "1";
  try {
    const id = createMcpServer("local", "stdio", "npx some-fake-mcp-server");
    const res = await discover.POST(
      new Request(`https://x/api/mcp-servers/${id}/discover`, {
        method: "POST",
        headers: authHeaders,
      }),
      { params: Promise.resolve({ id: String(id) }) }
    );
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /confirm/i);
  } finally {
    delete process.env.JROUTE_ALLOW_REMOTE_STDIO;
  }
});

test("POST confirm requires a session", async () => {
  const res = await confirm.POST(
    new Request("https://x/api/mcp-servers/1/confirm", { method: "POST" }),
    { params: Promise.resolve({ id: "1" }) }
  );
  assert.equal(res.status, 401);
});

test("POST confirm marks a stdio server confirmed", async () => {
  const { getMcpServer } = await import("../../src/lib/db/mcpServers.ts");
  const id = createMcpServer("local2", "stdio", "npx some-fake-mcp-server");
  assert.equal(getMcpServer(id)?.confirmedAt, null);
  const res = await confirm.POST(
    new Request(`https://x/api/mcp-servers/${id}/confirm`, {
      method: "POST",
      headers: authHeaders,
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);
  assert.ok(getMcpServer(id)?.confirmedAt);
});

test("POST confirm on a non-stdio server is 400", async () => {
  const id = createMcpServer("remote", "http", "https://mcp.example.com");
  const res = await confirm.POST(
    new Request(`https://x/api/mcp-servers/${id}/confirm`, {
      method: "POST",
      headers: authHeaders,
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 400);
});

test("POST test-invoke without a session is 401", async () => {
  const res = await testInvoke.POST(
    new Request("https://x/api/mcp-servers/1/test-invoke", {
      method: "POST",
      body: JSON.stringify({ toolName: "search" }),
    }),
    { params: Promise.resolve({ id: "1" }) }
  );
  assert.equal(res.status, 401);
});

test("POST test-invoke with an invalid body is 400", async () => {
  const id = createMcpServer("x", "http", "https://x.example.com");
  const res = await testInvoke.POST(
    new Request(`https://x/api/mcp-servers/${id}/test-invoke`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 400);
});
