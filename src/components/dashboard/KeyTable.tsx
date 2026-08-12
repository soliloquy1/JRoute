// src/components/dashboard/KeyTable.tsx
"use client";

import { useRouter } from "next/navigation";
import type { ApiKeyRecord, Preset } from "@/lib/db/types.ts";

export function KeyTable({ keys, presets }: { keys: ApiKeyRecord[]; presets: Preset[] }) {
  const router = useRouter();

  async function setPreset(id: number, presetId: number | null) {
    await fetch(`/api/keys/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId }),
    });
    router.refresh();
  }

  async function revoke(id: number) {
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-text-muted">
          <th className="py-2">Label</th>
          <th>Tool mode</th>
          <th>Preset</th>
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
