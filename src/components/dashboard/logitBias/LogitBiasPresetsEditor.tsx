// src/components/dashboard/logitBias/LogitBiasPresetsEditor.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LogitBiasPreset } from "@/lib/db/types.ts";
import { PrimaryButton, DangerButton, Field, inputClass, InlineError, EmptyState } from "../ui.tsx";

type Entry = { text: string; value: number };

export function LogitBiasPresetsEditor({ presets }: { presets: LogitBiasPreset[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(presets[0]?.id ?? null);
  const preset = presets.find((p) => p.id === selectedId) ?? null;
  const [name, setName] = useState(preset?.name ?? "");
  const [entries, setEntries] = useState<Entry[]>(preset?.entries ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function select(p: LogitBiasPreset) {
    setSelectedId(p.id);
    setName(p.name);
    setEntries(p.entries);
    setError(null);
  }

  function addEntry() {
    setEntries((prev) => [...prev, { text: "", value: 0 }]);
  }

  function updateEntry(index: number, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function removeEntry(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  async function createNew() {
    setError(null);
    const res = await fetch("/api/logit-bias-presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New Preset", entries: [] }),
    });
    if (!res.ok) {
      setError("Failed to create preset");
      return;
    }
    const { id } = (await res.json()) as { id: number };
    router.refresh();
    setSelectedId(id);
    setName("New Preset");
    setEntries([]);
  }

  async function save() {
    if (!preset) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/logit-bias-presets/${preset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, entries }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Failed to save preset");
      return;
    }
    router.refresh();
  }

  async function remove() {
    if (!preset) return;
    if (!window.confirm(`Delete preset "${preset.name}"? Keys using it will fall back to no bias.`))
      return;
    const res = await fetch(`/api/logit-bias-presets/${preset.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to delete preset");
      return;
    }
    setSelectedId(null);
    router.refresh();
  }

  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0 border-r border-border pr-4">
        <PrimaryButton onClick={createNew} className="mb-3 w-full">
          + New preset
        </PrimaryButton>
        <div className="flex flex-col gap-1">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => select(p)}
              className={`rounded-control px-2.5 py-1.5 text-left text-sm transition-colors ${
                p.id === selectedId
                  ? "bg-primary-soft font-medium text-primary"
                  : "text-text-muted hover:bg-bg-subtle hover:text-text-main"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </aside>

      <div className="flex-1">
        {!preset ? (
          <EmptyState
            icon="filter_alt"
            title="No logit bias presets yet"
            body="Create one to bias or ban specific words/phrases (or raw token IDs) for keys assigned to it."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <div className="flex flex-col gap-2">
              {entries.map((entry, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    placeholder="text, phrase, or [token,ids]"
                    value={entry.text}
                    onChange={(e) => updateEntry(i, { text: e.target.value })}
                  />
                  <input
                    type="number"
                    min={-100}
                    max={100}
                    className={`${inputClass} w-24`}
                    value={entry.value}
                    onChange={(e) => updateEntry(i, { value: Number(e.target.value) })}
                  />
                  <DangerButton onClick={() => removeEntry(i)}>Remove</DangerButton>
                </div>
              ))}
              <button
                onClick={addEntry}
                className="self-start rounded-control border border-dashed border-border-strong px-2.5 py-1 text-xs text-text-muted hover:bg-bg-subtle"
              >
                + Add entry
              </button>
            </div>

            <InlineError message={error} />

            <div className="flex items-center gap-2">
              <PrimaryButton onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </PrimaryButton>
              <DangerButton onClick={remove}>Delete preset</DangerButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
