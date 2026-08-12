// src/components/dashboard/prompts/PresetForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Preset, PromptBlock, Lorebook, ToolMode } from "@/lib/db/types.ts";

const TOOL_MODES: ToolMode[] = ["off", "trigger", "native"];

export function PresetForm({
  presets,
  blocks,
  lorebooks,
}: {
  presets: Preset[];
  blocks: PromptBlock[];
  lorebooks: Lorebook[];
}) {
  const router = useRouter();
  const [presetId, setPresetId] = useState<number | "">(presets[0]?.id ?? "");
  const [newPresetName, setNewPresetName] = useState("");
  const preset = presets.find((p) => p.id === presetId);

  async function createNew() {
    if (!newPresetName.trim()) return;
    const res = await fetch("/api/presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newPresetName.trim() }),
    });
    const { id } = (await res.json()) as { id: number };
    setNewPresetName("");
    setPresetId(id);
    router.refresh();
  }

  async function update(patch: Record<string, unknown>) {
    if (!preset) return;
    await fetch(`/api/presets/${preset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    router.refresh();
  }

  async function toggleLorebook(lorebookId: number) {
    if (!preset) return;
    const current = new Set(preset.lorebookIds);
    if (current.has(lorebookId)) current.delete(lorebookId);
    else current.add(lorebookId);
    await fetch(`/api/presets/${preset.id}/lorebooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lorebookIds: [...current] }),
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
      <div className="text-xs font-medium tracking-wide text-text-muted">EDIT PRESET</div>
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
      <div className="flex gap-2">
        <input
          placeholder="New preset name"
          value={newPresetName}
          onChange={(e) => setNewPresetName(e.target.value)}
          className="flex-1 rounded-control border border-border bg-bg-subtle p-2 text-xs text-text-main"
        />
        <button
          onClick={createNew}
          className="rounded-control bg-primary px-2 py-1 text-xs text-white hover:bg-primary-hover"
        >
          + New preset
        </button>
      </div>
      {preset && (
        <>
          <label className="text-xs text-text-muted">
            Prepend block
            <select
              value={preset.prependBlockId ?? ""}
              onChange={(e) =>
                update({ prependBlockId: e.target.value ? Number(e.target.value) : null })
              }
              className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
            >
              <option value="">none</option>
              {blocks
                .filter((b) => b.kind === "prepend")
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-text-muted">
            Append block
            <select
              value={preset.appendBlockId ?? ""}
              onChange={(e) =>
                update({ appendBlockId: e.target.value ? Number(e.target.value) : null })
              }
              className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
            >
              <option value="">none</option>
              {blocks
                .filter((b) => b.kind === "append")
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-text-muted">
            Tool mode
            <select
              value={preset.toolMode}
              onChange={(e) => update({ toolMode: e.target.value })}
              className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
            >
              {TOOL_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-text-muted">Lorebooks</div>
          <div className="flex flex-col gap-1">
            {lorebooks.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm text-text-main">
                <input
                  type="checkbox"
                  checked={preset.lorebookIds.includes(l.id)}
                  onChange={() => toggleLorebook(l.id)}
                />
                {l.name}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
