// src/lib/dashboard/importProviderModels.ts
import type { Provider } from "@/lib/db/types.ts";

/**
 * Fetches a provider's live model list and returns the native model ids.
 * - openai / openai-compatible: GET {baseUrl}/models  (Authorization: Bearer <key>)
 * - gemini: GET {baseUrl}/v1beta/models?key=<key>
 * - anthropic: callers must refuse before calling this (no public list exists).
 *
 * Pure network + parse — no DB writes — so it can be unit-tested with a mocked fetch.
 */
export async function pullProviderModelIds(provider: Provider, apiKey: string): Promise<string[]> {
  let url: string;
  const base = provider.baseUrl.replace(/\/$/, "");
  let headers: Record<string, string> = {};
  if (provider.wireFormat === "gemini") {
    const geminiBase = base.endsWith("/") ? base : `${base}/`;
    url = `${new URL("v1beta/models", geminiBase).href}?key=${encodeURIComponent(apiKey)}`;
  } else {
    url = `${base}/models`;
    headers = { Authorization: `Bearer ${apiKey}` };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let fetched: Response;
  try {
    fetched = await fetch(url, { headers, signal: controller.signal });
  } catch (e) {
    clearTimeout(timeout);
    throw new Error(`Failed to reach provider models endpoint: ${(e as Error).message}`);
  }
  clearTimeout(timeout);

  if (!fetched.ok) {
    const text = await fetched.text().catch(() => "");
    const redacted = apiKey ? text.split(apiKey).join("[redacted]") : text;
    throw new Error(`Provider returned ${fetched.status} from /models: ${redacted.slice(0, 200)}`);
  }

  const payload = (await fetched.json().catch(() => null)) as
    | { data?: Array<{ id: string }>; models?: Array<{ name: string }> }
    | null;
  if (!payload) throw new Error("Provider returned a non-JSON model list");

  if (provider.wireFormat === "gemini") {
    return (payload.models ?? []).map((m) => m.name.replace(/^models\//, "")).filter(Boolean);
  }
  return (payload.data ?? []).map((m) => m.id).filter(Boolean);
}
