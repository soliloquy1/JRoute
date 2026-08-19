// src/lib/search/backends/index.ts
import type { SearchProviderKind } from "../../db/types.ts";
import type { SearchBackend } from "./types.ts";
import { createBraveBackend } from "./brave.ts";
import { createSerpApiBackend } from "./serpapi.ts";
import { createGoogleCseBackend } from "./googleCse.ts";
import { createTavilyBackend } from "./tavily.ts";

/** `fetchImpl` defaults to the global `fetch` — tests inject a mock to assert request
 * shape without a real network call. Production callers (Task 5) never pass this arg. */
export function getBackend(
  kind: SearchProviderKind,
  fetchImpl: typeof fetch = fetch
): SearchBackend {
  switch (kind) {
    case "brave":
      return createBraveBackend(fetchImpl);
    case "serpapi":
      return createSerpApiBackend(fetchImpl);
    case "google_cse":
      return createGoogleCseBackend(fetchImpl);
    case "tavily":
      return createTavilyBackend(fetchImpl);
  }
}
