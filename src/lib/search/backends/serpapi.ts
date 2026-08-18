// src/lib/search/backends/serpapi.ts
import type { SearchBackend, SearchResult } from "./types.ts";

interface SerpApiResponse {
  organic_results?: Array<{ title: string; link: string; snippet: string }>;
}

export function createSerpApiBackend(fetchImpl: typeof fetch): SearchBackend {
  return {
    async search(apiKey, _config, query): Promise<SearchResult[]> {
      const url = new URL("https://serpapi.com/search");
      url.searchParams.set("engine", "google");
      url.searchParams.set("q", query);
      url.searchParams.set("api_key", apiKey);
      const res = await fetchImpl(url);
      if (!res.ok) return [];
      const body = (await res.json()) as SerpApiResponse;
      return (body.organic_results ?? []).map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
      }));
    },
  };
}
