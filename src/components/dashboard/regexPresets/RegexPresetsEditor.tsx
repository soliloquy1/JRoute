// src/components/dashboard/regexPresets/RegexPresetsEditor.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RegexPreset } from "@/lib/db/types.ts";
import { PrimaryButton, DangerButton, GhostButton, Field, inputClass, InlineError, EmptyState } from "../ui.tsx";

type Script = {
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: number[];
  disabled: boolean;
  substituteRegex: 0 | 1 | 2;
};

function emptyScript(): Script {
  return {
    scriptName: "New script",
    findRegex: "",
    replaceString: "",
    trimStrings: [],
    placement: [1, 2],
    disabled: false,
    substituteRegex: 0,
  };
}

export function RegexPresetsEditor({ presets }: { presets: RegexPreset[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(presets[0]?.id ?? null);
  const preset = presets.find((p) => p.id === selectedId) ?? null;
  const [name, setName] = useState(preset?.name ?? "");
  const [scripts, setScripts] = useState<Script[]>((preset?.scripts as Script[]) ?? []);
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function select(p: RegexPreset) {
    setSelectedId(p.id);
    setName(p.name);
    setScripts(p.scripts as Script[]);
    setError(null);
  }

  function addScript() {
    setScripts((prev) => [...prev, emptyScript()]);
  }

  function updateScript(index: number, patch: Partial<Script>) {
    setScripts((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeScript(index: number) {
    setScripts((prev) => prev.filter((_, i) => i !== index));
  }

  function moveScript(index: number, direction: -1 | 1) {
    setScripts((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function togglePlacement(index: number, value: 1 | 2) {
    setScripts((prev) =>
      prev.map((s, i) =>
        i === index
          ? {
              ...s,
              placement: s.placement.includes(value)
                ? s.placement.filter((p) => p !== value)
                : [...s.placement, value],
            }
          : s
      )
    );
  }

  function importFromJson() {
    setError(null);
    try {
      const parsed = JSON.parse(importText) as unknown;
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      setScripts((prev) => [...prev, ...(arr as Script[])]);
      setImportText("");
    } catch {
      setError("Could not parse the pasted JSON — expected a SillyTavern regex-script export.");
    }
  }

  async function createNew() {
    setError(null);
    const res = await fetch("/api/regex-presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New Preset", scripts: [] }),
    });
    if (!res.ok) {
      setError("Failed to create preset");
      return;
    }
    const { id } = (await res.json()) as { id: number };
    router.refresh();
    setSelectedId(id);
    setName("New Preset");
    setScripts([]);
  }

  async function save() {
    if (!preset) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/regex-presets/${preset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scripts }),
    });
    if (!res.ok) {
      setSaving(false);
      const body = await res.json().catch(() => null);
      setError((body as { error?: { message?: string } } | null)?.error?.message ?? "Failed to save preset");
      return;
    }
    // Re-read the stored copy: an unsafe pattern is rejected before this point, but a
    // successful write still normalizes defaults server-side (same read-back-after-write
    // shape as LogitBiasPresetsEditor.save()).
    const stored = await fetch(`/api/regex-presets/${preset.id}`);
    if (stored.ok) {
      const fresh = (await stored.json()) as RegexPreset;
      setName(fresh.name);
      setScripts(fresh.scripts as Script[]);
    }
    setSaving(false);
    router.refresh();
  }

  async function remove() {
    if (!preset) return;
    if (!window.confirm(`Delete preset "${preset.name}"? Keys using it will fall back to no transform.`))
      return;
    const res = await fetch(`/api/regex-presets/${preset.id}`, { method: "DELETE" });
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
            icon="find_replace"
            title="No regex presets yet"
            body="Create one to port a SillyTavern regex script bundle to clients that have no Regex extension of their own (JanitorAI, etc.)."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>

            <div className="flex flex-col gap-2">
              {scripts.map((script, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-control border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      className={inputClass}
                      placeholder="Script name"
                      value={script.scriptName}
                      onChange={(e) => updateScript(i, { scriptName: e.target.value })}
                    />
                    <GhostButton onClick={() => moveScript(i, -1)} disabled={i === 0}>
                      ↑
                    </GhostButton>
                    <GhostButton onClick={() => moveScript(i, 1)} disabled={i === scripts.length - 1}>
                      ↓
                    </GhostButton>
                    <DangerButton onClick={() => removeScript(i)}>Remove</DangerButton>
                  </div>
                  <input
                    className={inputClass}
                    placeholder="/pattern/flags"
                    value={script.findRegex}
                    onChange={(e) => updateScript(i, { findRegex: e.target.value })}
                  />
                  <input
                    className={inputClass}
                    placeholder="replaceString ({{match}}, $1-$99 supported)"
                    value={script.replaceString}
                    onChange={(e) => updateScript(i, { replaceString: e.target.value })}
                  />
                  <input
                    className={inputClass}
                    placeholder="trimStrings, comma-separated"
                    value={script.trimStrings.join(",")}
                    onChange={(e) =>
                      updateScript(i, {
                        trimStrings: e.target.value.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
                      })
                    }
                  />
                  <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={script.placement.includes(1)}
                        onChange={() => togglePlacement(i, 1)}
                      />
                      User Input
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={script.placement.includes(2)}
                        onChange={() => togglePlacement(i, 2)}
                      />
                      AI Output
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={script.disabled}
                        onChange={(e) => updateScript(i, { disabled: e.target.checked })}
                      />
                      Disabled
                    </label>
                    <label className="flex items-center gap-1">
                      Macros in pattern
                      <select
                        value={script.substituteRegex}
                        onChange={(e) =>
                          updateScript(i, { substituteRegex: Number(e.target.value) as 0 | 1 | 2 })
                        }
                        className="rounded-control border border-border-strong bg-card px-1 py-0.5"
                      >
                        <option value={0}>Off</option>
                        <option value={1}>Raw</option>
                        <option value={2}>Escaped</option>
                      </select>
                    </label>
                  </div>
                </div>
              ))}
              <button
                onClick={addScript}
                className="self-start rounded-control border border-dashed border-border-strong px-2.5 py-1 text-xs text-text-muted hover:bg-bg-subtle"
              >
                + Add script
              </button>
            </div>

            <Field label="Import SillyTavern regex-script JSON">
              <textarea
                className={`${inputClass} h-24 font-mono text-xs`}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='[{"scriptName": "...", "findRegex": "/.../g", "replaceString": "..."}]'
              />
              <GhostButton onClick={importFromJson} className="mt-1">
                Import
              </GhostButton>
            </Field>

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
