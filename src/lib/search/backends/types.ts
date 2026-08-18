// src/lib/search/backends/types.ts
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchBackend {
  search(apiKey: string, config: unknown, query: string): Promise<SearchResult[]>;
}
