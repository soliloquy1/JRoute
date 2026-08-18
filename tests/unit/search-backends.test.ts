// tests/unit/search-backends.test.ts
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { getBackend } from "../../src/lib/search/backends/index.ts";

test("brave backend sends the subscription token header and maps results", async () => {
  const fetchMock = mock.fn(async (url: string | URL, init?: RequestInit) => {
    assert.ok(String(url).startsWith("https://api.search.brave.com/res/v1/web/search?q="));
    assert.equal((init?.headers as Record<string, string>)["X-Subscription-Token"], "brave-key");
    return new Response(
      JSON.stringify({
        web: { results: [{ title: "T", url: "https://e.com", description: "S" }] },
      }),
      { status: 200 }
    );
  });
  const backend = getBackend("brave", fetchMock as unknown as typeof fetch);
  const results = await backend.search("brave-key", null, "cats");
  assert.deepEqual(results, [{ title: "T", url: "https://e.com", snippet: "S" }]);
});

test("brave backend returns [] and does not throw on a non-2xx response", async () => {
  const fetchMock = mock.fn(async () => new Response("rate limited", { status: 429 }));
  const backend = getBackend("brave", fetchMock as unknown as typeof fetch);
  const results = await backend.search("brave-key", null, "cats");
  assert.deepEqual(results, []);
});

test("serpapi backend builds the expected query string and maps organic_results", async () => {
  const fetchMock = mock.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    assert.equal(u.searchParams.get("engine"), "google");
    assert.equal(u.searchParams.get("q"), "cats");
    assert.equal(u.searchParams.get("api_key"), "serp-key");
    return new Response(
      JSON.stringify({ organic_results: [{ title: "T", link: "https://e.com", snippet: "S" }] }),
      { status: 200 }
    );
  });
  const backend = getBackend("serpapi", fetchMock as unknown as typeof fetch);
  const results = await backend.search("serp-key", null, "cats");
  assert.deepEqual(results, [{ title: "T", url: "https://e.com", snippet: "S" }]);
});

test("google_cse backend requires config.cx and includes it in the query", async () => {
  const fetchMock = mock.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    assert.equal(u.searchParams.get("cx"), "my-cx");
    assert.equal(u.searchParams.get("key"), "cse-key");
    return new Response(
      JSON.stringify({ items: [{ title: "T", link: "https://e.com", snippet: "S" }] }),
      { status: 200 }
    );
  });
  const backend = getBackend("google_cse", fetchMock as unknown as typeof fetch);
  const results = await backend.search("cse-key", { cx: "my-cx" }, "cats");
  assert.deepEqual(results, [{ title: "T", url: "https://e.com", snippet: "S" }]);
});

test("google_cse backend returns [] when config.cx is missing, does not throw", async () => {
  const backend = getBackend(
    "google_cse",
    (async () => new Response("{}")) as unknown as typeof fetch
  );
  const results = await backend.search("cse-key", null, "cats");
  assert.deepEqual(results, []);
});
