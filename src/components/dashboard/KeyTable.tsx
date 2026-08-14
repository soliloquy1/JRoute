// src/components/dashboard/KeyTable.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiKeyRecord, Preset, RichPreset } from "@/lib/db/types.ts";
import { EmptyState, InlineError } from "./ui.tsx";

/**
 * One dropdown per key covers both preset kinds — the backend enforces mutual
 * exclusivity (setting one clears the other), so presenting them as two columns
 * would let the UI claim a state that cannot exist. Optgroups keep the two kinds
 * visually distinct instead.
 */
function presetValue(k: ApiKeyRecord): string {
  if (k.richPresetId !== null) return `rich:${k.richPresetId}`;
  if (k.presetId !== null) return `simple:${k.presetId}`;
  return "";
}

function activePresetName(
  k: ApiKeyRecord,
  presets: Preset[],
  richPresets: RichPreset[]
): string | null {
  if (k.richPresetId !== null)
    return richPresets.find((p) => p.id === k.richPresetId)?.name ?? null;
  if (k.presetId !== null) return presets.find((p) => p.id === k.presetId)?.name ?? null;
  return null;
}

export function KeyTable({
  keys,
  presets,
  richPresets,
}: {
  keys: ApiKeyRecord[];
  presets: Preset[];
  richPresets: RichPreset[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function setPreset(id: number, value: string) {
    setError(null);
    const body =
      value === ""
        ? { presetId: null }
        : value.startsWith("rich:")
          ? { richPresetId: Number(value.slice(5)) }
          : { presetId: Number(value.slice(7)) };
    const res = await fetch(`/api/keys/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError(`Failed to update preset for key ${id}`);
      return;
    }
    router.refresh();
  }

  async function revoke(id: number, label: string) {
    if (!window.confirm(`Revoke key "${label}"? Clients using it will stop working immediately.`))
      return;
    setError(null);
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(`Failed to revoke key ${id}`);
      return;
    }
    router.refresh();
  }

  if (keys.length === 0) {
    return (
      <EmptyState
        icon="key"
        title="No API keys yet"
        body="Keys authenticate your client (SillyTavern) against this proxy and carry the preset a chat runs through."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th className="px-4 py-2.5 font-medium">Label</th>
            <th className="px-4 py-2.5 font-medium">Tool mode</th>
            <th className="px-4 py-2.5 font-medium">Preset</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr
              key={k.id}
              className="border-b border-border/60 text-text-main last:border-0 hover:bg-bg-subtle/50"
            >
              <td className="px-4 py-2.5 font-medium">{k.label}</td>
              <td className="px-4 py-2.5">
                <span className="rounded-full bg-bg-subtle px-2 py-0.5 font-mono text-[11px] text-text-muted">
                  {k.toolMode}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <select
                  value={presetValue(k)}
                  onChange={(e) => setPreset(k.id, e.target.value)}
                  className="rounded-control border border-border-strong bg-card px-2 py-1 text-xs text-text-main focus:border-primary"
                >
                  <option value="">none</option>
                  {richPresets.length > 0 && (
                    <optgroup label="SillyTavern presets">
                      {richPresets.map((p) => (
                        <option key={p.id} value={`rich:${p.id}`}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {presets.length > 0 && (
                    <optgroup label="Simple presets">
                      {presets.map((p) => (
                        <option key={p.id} value={`simple:${p.id}`}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {(() => {
                  const name = activePresetName(k, presets, richPresets);
                  return (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                      {name ? (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          <span className="text-success">{name}</span>
                        </>
                      ) : (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-text-muted" />
                          <span className="text-text-muted">No preset</span>
                        </>
                      )}
                    </div>
                  );
                })()}
              </td>
              <td className="px-4 py-2.5 text-right">
                <button
                  onClick={() => revoke(k.id, k.label)}
                  className="rounded-control px-2 py-1 text-xs text-text-muted transition-colors hover:bg-error/10 hover:text-error"
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && (
        <div className="border-t border-border px-4 py-2">
          <InlineError message={error} />
        </div>
      )}
    </div>
  );
}
