// tests/unit/mcp-builtin-search-server.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SearchBackend } from "../../src/lib/search/backends/types.ts";

const dir = mkdtempSync(join(tmpdir(), "jroute-builtin-search-test-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { createSearchProvider } = await import("../../src/lib/db/searchProviders.ts");
const { setActiveSearchProviderId } = await import("../../src/lib/db/settings.ts");
const { createBuiltinSearchServer, readBoundedText } =
  await import("../../src/lib/mcp/builtinSearchServer.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM search_providers").run();
  getDb().prepare("DELETE FROM settings").run();
});

async function connectedClient(getBackendImpl?: (kind: string) => SearchBackend) {
  const server = createBuiltinSearchServer(getBackendImpl);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

test("lists web_search and web_fetch with input schemas", async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["web_fetch", "web_search"]);
  const searchTool = tools.find((t) => t.name === "web_search")!;
  assert.equal(searchTool.inputSchema.type, "object");
  await client.close();
});

test("web_search with no active provider returns tool-error content, does not throw", async () => {
  const client = await connectedClient();
  const result = await client.callTool({ name: "web_search", arguments: { query: "cats" } });
  assert.equal(result.isError, true);
  await client.close();
});

test("web_search calls the active backend and returns formatted results", async () => {
  const id = createSearchProvider("brave", "Test Brave", "brave-key");
  setActiveSearchProviderId(id);
  const fakeBackend: SearchBackend = {
    search: async () => [{ title: "Cats!", url: "https://e.com/cats", snippet: "All about cats." }],
  };
  const client = await connectedClient(() => fakeBackend);
  const result = await client.callTool({ name: "web_search", arguments: { query: "cats" } });
  assert.equal(result.isError, undefined);
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("Cats!"));
  assert.ok(text.includes("https://e.com/cats"));
  await client.close();
});

test("web_fetch blocks a loopback URL via the SSRF gate (not merely a connection failure)", async () => {
  // A *listening* loopback server proves the guard is the SSRF filter, not a refused
  // connection: raw undici fetch reaches it (control), but mcpSafeFetch blocks it.
  const httpServer: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<p>loopback-secret</p>");
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const loopbackUrl = `http://127.0.0.1:${port}/`;

  try {
    const control = await fetch(loopbackUrl);
    assert.equal(
      await control.text(),
      "<p>loopback-secret</p>",
      "control: raw fetch reaches the listener"
    );

    const client = await connectedClient();
    const result = await client.callTool({ name: "web_fetch", arguments: { url: loopbackUrl } });
    assert.equal(result.isError, true, "SSRF gate must block the loopback URL");
    await client.close();
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test("web_search refuses to run when the provider api key cannot be decrypted", async () => {
  const id = createSearchProvider("brave", "Rotated", "brave-key");
  setActiveSearchProviderId(id);
  // Simulate a rotated/lost STORAGE_ENCRYPTION_KEY.
  getDb()
    .prepare("UPDATE search_providers SET api_key = ? WHERE id = ?")
    .run("enc:v1:not-a-real-ciphertext", id);

  let called = false;
  const fakeBackend: SearchBackend = {
    search: async () => {
      called = true;
      return [];
    },
  };
  const client = await connectedClient(() => fakeBackend);
  const result = await client.callTool({ name: "web_search", arguments: { query: "cats" } });
  assert.equal(result.isError, true);
  assert.equal(called, false, "must not call the backend with an empty api key");
  await client.close();
});

test("readBoundedText stops reading once the byte budget is spent", async () => {
  let pushed = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      // Would stream forever if the reader did not cancel at the cap.
      pushed += 1024;
      controller.enqueue(new Uint8Array(1024).fill(0x61));
      if (pushed > 1024 * 1024) controller.close();
    },
  });
  const text = await readBoundedText(new Response(stream), 4096);
  assert.equal(text.length, 4096, "must truncate at the cap");
  assert.ok(pushed <= 1024 * 64, `must stop pulling early, pulled ${pushed} bytes`);
});

test("readBoundedText returns the whole body when it fits under the cap", async () => {
  const text = await readBoundedText(new Response("hello world"), 4096);
  assert.equal(text, "hello world");
});

test("web_fetch query length is bounded before reaching the backend", async () => {
  const id = createSearchProvider("brave", "Test Brave", "brave-key");
  setActiveSearchProviderId(id);
  let receivedQuery = "";
  const fakeBackend: SearchBackend = {
    search: async (_key: string, _cfg: unknown, query: string) => {
      receivedQuery = query;
      return [];
    },
  };
  const client = await connectedClient(() => fakeBackend);
  await client.callTool({ name: "web_search", arguments: { query: "x".repeat(2000) } });
  assert.ok(
    receivedQuery.length <= 500,
    `expected bounded query, got ${receivedQuery.length} chars`
  );
  await client.close();
});
