// src/components/dashboard/prompts/PresetForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Preset, PromptBlock, Lorebook, ToolMode } from "@/lib/db/types.ts";
import { PrimaryButton, Field, inputClass, InlineError, SectionTitle } from "../ui.tsx";

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
  const [error, setError] = useState<string | null>(null);
  const preset = presets.find((p) => p.id === presetId);

  async function createNew() {
    if (!newPresetName.trim()) return;
    setError(null);
    const res = await fetch("/api/presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newPresetName.trim() }),
    });
    if (!res.ok) {
      setError("Failed to create preset");
      return;
    }
    const { id } = (await res.json()) as { id: number };
    setNewPresetName("");
    setPresetId(id);
    router.refresh();
  }

  async function update(patch: Record<string, unknown>) {
    if (!preset) return;
    setError(null);
    const res = await fetch(`/api/presets/${preset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setError("Failed to save preset");
      return;
    }
    router.refresh();
  }

  async function toggleLorebook(lorebookId: number) {
    if (!preset) return;
    const current = new Set(preset.lorebookIds);
    if (current.has(lorebookId)) current.delete(lorebookId);
    else current.add(lorebookId);
    setError(null);
    const res = await fetch(`/api/presets/${preset.id}/lorebooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lorebookIds: [...current] }),
    });
    if (!res.ok) {
      setError("Failed to update lorebooks");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-soft">
      <SectionTitle>Simple preset</SectionTitle>
      <p className="text-[11px] leading-relaxed text-text-muted">
        A simple preset is a prepend block + append block + lorebooks. For full SillyTavern
        prompt orders and samplers, use the Presets page instead.
      </p>
      {presets.length > 0 && (
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
      )}
      <div className="flex gap-2">
        <input
          placeholder="New preset name"
          value={newPresetName}
          onChange={(e) => setNewPresetName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void createNew();
            }
          }}
          className={`${inputClass} flex-1`}
        />
        <PrimaryButton onClick={createNew} disabled={!newPresetName.trim()}>
          Create
        </PrimaryButton>
      </div>
      <InlineError message={error} />
      {preset && (
        <>
          <Field label="Prepend block">
            <select
              value={preset.prependBlockId ?? ""}
              onChange={(e) =>
                update({ prependBlockId: e.target.value ? Number(e.target.value) : null })
              }
              className={inputClass}
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
          </Field>
          <Field label="Append block">
            <select
              value={preset.appendBlockId ?? ""}
              onChange={(e) =>
                update({ appendBlockId: e.target.value ? Number(e.target.value) : null })
              }
              className={inputClass}
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
          </Field>
          <Field label="Tool mode">
            <select
              value={preset.toolMode}
              onChange={(e) => update({ toolMode: e.target.value })}
              className={inputClass}
            >
              {TOOL_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          {lorebooks.length > 0 && (
            <div>
              <span className="mb-1 block text-xs font-medium text-text-muted">Lorebooks</span>
              <div className="flex flex-col gap-1">
                {lorebooks.map((l) => (
                  <label
                    key={l.id}
                    className="flex items-center gap-2 rounded-control px-1 py-0.5 text-sm text-text-main hover:bg-bg-subtle"
                  >
                    <input
                      type="checkbox"
                      checked={preset.lorebookIds.includes(l.id)}
                      onChange={() => toggleLorebook(l.id)}
                      className="accent-primary"
                    />
                    {l.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
