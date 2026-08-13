// src/components/dashboard/prompts/PreviewPanel.tsx
"use client";

import { useState } from "react";
import type { Preset } from "@/lib/db/types.ts";
import { PrimaryButton, inputClass, SectionTitle } from "../ui.tsx";
import { cn } from "@/lib/cn.ts";

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
    <div className="flex flex-1 flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-soft">
      <SectionTitle>Live preview</SectionTitle>
      <p className="text-[11px] leading-relaxed text-text-muted">
        The exact request body an upstream would receive, rendered per wire format.
      </p>
      {presets.length === 0 ? (
        <p className="text-xs text-text-muted">Create a simple preset above to preview it.</p>
      ) : (
        <>
          <select
            value={presetId}
            onChange={(e) => setPresetId(Number(e.target.value))}
            className={inputClass}
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1 rounded-control border border-border p-0.5">
            {FORMATS.map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={cn(
                  "flex-1 rounded-[5px] px-2 py-1 font-mono text-[11px] transition-colors",
                  format === f
                    ? "bg-primary font-medium text-white"
                    : "text-text-muted hover:bg-bg-subtle hover:text-text-main"
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <PrimaryButton onClick={refresh} disabled={loading || !presetId}>
            {loading ? "Refreshing…" : "Refresh preview"}
          </PrimaryButton>
          {error && <p className="text-xs text-error">{error}</p>}
          {payload && (
            <pre className="max-h-96 overflow-auto rounded-control border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-text-main">
              {payload}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
