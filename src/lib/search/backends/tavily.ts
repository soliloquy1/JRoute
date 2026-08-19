// src/lib/search/backends/tavily.ts
import type { SearchBackend, SearchResult } from "./types.ts";

interface TavilyResponse {
  results?: Array<{ title: string; url: string; content: string }>;
}

export function createTavilyBackend(fetchImpl: typeof fetch): SearchBackend {
  return {
    async search(apiKey, _config, query): Promise<SearchResult[]> {
      const res = await fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query }),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as TavilyResponse;
      return (body.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
      }));
    },
  };
}
