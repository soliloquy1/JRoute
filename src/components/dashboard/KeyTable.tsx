// src/components/dashboard/KeyTable.tsx
"use client";

import { useRouter } from "next/navigation";
import type { ApiKeyRecord, Preset, RichPreset } from "@/lib/db/types.ts";

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

  async function setPreset(id: number, presetId: number | null) {
    const res = await fetch(`/api/keys/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId }),
    });
    if (!res.ok) {
      console.error("Failed to set preset for key", id);
      return;
    }
    router.refresh();
  }

  async function setRichPreset(id: number, richPresetId: number | null) {
    const res = await fetch(`/api/keys/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ richPresetId }),
    });
    if (!res.ok) {
      console.error("Failed to set rich preset for key", id);
      return;
    }
    router.refresh();
  }

  async function revoke(id: number) {
    if (!window.confirm("Revoke this key?")) return;
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (!res.ok) {
      console.error("Failed to revoke key", id);
      return;
    }
    router.refresh();
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-text-muted">
          <th className="py-2">Label</th>
          <th>Tool mode</th>
          <th>Preset</th>
          <th>ST Preset</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k.id} className="border-b border-border text-text-main">
            <td className="py-2">{k.label}</td>
            <td>{k.toolMode}</td>
            <td>
              <select
                value={k.presetId ?? ""}
                onChange={(e) => setPreset(k.id, e.target.value ? Number(e.target.value) : null)}
                className="rounded-control border border-border bg-bg-subtle p-1 text-xs text-text-main"
              >
                <option value="">none</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <select
                value={k.richPresetId ?? ""}
                onChange={(e) =>
                  setRichPreset(k.id, e.target.value ? Number(e.target.value) : null)
                }
                className="rounded-control border border-border bg-bg-subtle p-1 text-xs text-text-main"
              >
                <option value="">none</option>
                {richPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <button onClick={() => revoke(k.id)} className="text-xs text-error hover:underline">
                Revoke
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
