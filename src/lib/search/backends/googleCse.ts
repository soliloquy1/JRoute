// src/lib/search/backends/googleCse.ts
import type { SearchBackend, SearchResult } from "./types.ts";

interface GoogleCseResponse {
  items?: Array<{ title: string; link: string; snippet: string }>;
}

function extractCx(config: unknown): string | null {
  if (config && typeof config === "object" && "cx" in config) {
    const cx = (config as { cx?: unknown }).cx;
    return typeof cx === "string" && cx.length > 0 ? cx : null;
  }
  return null;
}

export function createGoogleCseBackend(fetchImpl: typeof fetch): SearchBackend {
  return {
    async search(apiKey, config, query): Promise<SearchResult[]> {
      const cx = extractCx(config);
      if (!cx) return [];
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("cx", cx);
      url.searchParams.set("q", query);
      const res = await fetchImpl(url);
      if (!res.ok) return [];
      const body = (await res.json()) as GoogleCseResponse;
      return (body.items ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }));
    },
  };
}
