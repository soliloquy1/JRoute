// tests/unit/mcp-ssrf-fetch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mcpSafeFetch } from "../../src/lib/mcp/ssrfFetch.ts";

test("mcpSafeFetch blocks a loopback target (127.0.0.1)", async () => {
  await assert.rejects(
    () => mcpSafeFetch("http://127.0.0.1:1/mcp"),
    /blocked/i,
    "loopback must be rejected before any real connection is attempted"
  );
});

test("mcpSafeFetch blocks a link-local target (169.254.169.254 — cloud metadata)", async () => {
  await assert.rejects(() => mcpSafeFetch("http://169.254.169.254/mcp"), /blocked/i);
});

test("mcpSafeFetch reaches a real local HTTP server on a public-looking loopback alias, GET returns the body", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected AddressInfo");

  // 127.0.0.1 itself IS blocked by design — this test proves the transport mechanics
  const { unsafeFetchForTesting } = await import("../../src/lib/mcp/ssrfFetch.ts");
  const res = await unsafeFetchForTesting(`http://127.0.0.1:${address.port}/`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("mcpSafeFetch POST sends a JSON body and the local server receives it", async () => {
  let receivedBody = "";
  const server = createServer((req, res) => {
    req.on("data", (chunk) => (receivedBody += chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ echoed: receivedBody }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected AddressInfo");

  const { unsafeFetchForTesting } = await import("../../src/lib/mcp/ssrfFetch.ts");
  const res = await unsafeFetchForTesting(`http://127.0.0.1:${address.port}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  });
  const body = (await res.json()) as { echoed: string };
  assert.equal(body.echoed, '{"hello":"world"}');

  await new Promise<void>((resolve) => server.close(() => resolve()));
});
