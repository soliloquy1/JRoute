// src/components/dashboard/prompts/PreviewPanel.tsx
"use client";

import { useState } from "react";
import type { Preset } from "@/lib/db/types.ts";

const FORMATS = ["openai", "anthropic", "gemini"] as const;

export function PreviewPanel({ presets }: { presets: Preset[] }) {
  const [presetId, setPresetId] = useState<number | "">(presets[0]?.id ?? "");
  const [format, setFormat] = useState<(typeof FORMATS)[number]>("openai");
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!presetId) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId, wireFormat: format }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = (await res.json()) as { error: { message: string } };
      setError(body.error.message);
      setPayload(null);
      return;
    }
    const body = (await res.json()) as { upstreamBody: Record<string, unknown> };
    setPayload(JSON.stringify(body.upstreamBody, null, 2));
  }

  return (
    <div className="flex flex-1 flex-col gap-2 rounded-card border border-border bg-card p-4">
      <div className="text-xs font-medium tracking-wide text-text-muted">LIVE PREVIEW</div>
      <select
        value={presetId}
        onChange={(e) => setPresetId(Number(e.target.value))}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      >
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="flex gap-1">
        {FORMATS.map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            className={`rounded-control px-2 py-1 text-xs ${
              format === f ? "bg-primary text-white" : "text-text-main hover:bg-bg-subtle"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <button
        onClick={refresh}
        disabled={loading}
        className="rounded-control bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover disabled:opacity-50"
      >
        {loading ? "Refreshing…" : "Refresh preview"}
      </button>
      {error && <p className="text-xs text-error">{error}</p>}
      {payload && (
        <pre className="max-h-96 overflow-auto rounded-control bg-bg-subtle p-2 text-xs text-text-main">
          {payload}
        </pre>
      )}
    </div>
  );
}
