// src/lib/search/backends/brave.ts
import type { SearchBackend, SearchResult } from "./types.ts";

interface BraveResponse {
  web?: { results?: Array<{ title: string; url: string; description: string }> };
}

export function createBraveBackend(fetchImpl: typeof fetch): SearchBackend {
  return {
    async search(apiKey, _config, query): Promise<SearchResult[]> {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
      const res = await fetchImpl(url, { headers: { "X-Subscription-Token": apiKey } });
      if (!res.ok) return [];
      const body = (await res.json()) as BraveResponse;
      return (body.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      }));
    },
  };
}
