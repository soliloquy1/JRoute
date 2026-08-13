// src/components/dashboard/richPresets/RichPresetsEditor.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RichPreset } from "@/lib/db/types.ts";
import type { RichPresetJson, RichPromptEntry } from "@/lib/prompts/stPresetSchema.ts";
import type { Lorebook } from "@/lib/db/types.ts";
import { RichPresetPromptRow } from "./RichPresetPromptRow.tsx";

const SAMPLER_FIELDS: Array<keyof RichPresetJson> = [
  "temperature",
  "top_p",
  "top_k",
  "top_a",
  "min_p",
  "repetition_penalty",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "n",
];

export function RichPresetsEditor({
  presets,
  lorebooks,
}: {
  presets: RichPreset[];
  lorebooks: Lorebook[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(presets[0]?.id ?? null);
  const preset = presets.find((p) => p.id === selectedId) ?? null;
  const [draft, setDraft] = useState<RichPresetJson | null>(preset?.raw ?? null);
  const [charName, setCharName] = useState(preset?.charName ?? "");
  const [userName, setUserName] = useState(preset?.userName ?? "");
  const [importError, setImportError] = useState<string | null>(null);

  function select(p: RichPreset) {
    setSelectedId(p.id);
    setDraft(p.raw);
    setCharName(p.charName);
    setUserName(p.userName);
    setImportError(null);
  }

  async function handleImport(file: File) {
    setImportError(null);
    const text = await file.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setImportError("Not valid JSON");
      return;
    }
    const res = await fetch("/api/rich-presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: file.name.replace(/\.json$/i, ""), raw }),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error: { message: string } };
      setImportError(body.error.message);
      return;
    }
    router.refresh();
  }

  async function save() {
    if (!preset || !draft) return;
    await fetch(`/api/rich-presets/${preset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: draft, charName, userName }),
    });
    router.refresh();
  }

  async function remove() {
    if (!preset) return;
    await fetch(`/api/rich-presets/${preset.id}`, { method: "DELETE" });
    setSelectedId(null);
    setDraft(null);
    router.refresh();
  }

  async function toggleLorebook(lorebookId: number) {
    if (!preset) return;
    const current = new Set(preset.lorebookIds);
    if (current.has(lorebookId)) current.delete(lorebookId);
    else current.add(lorebookId);
    await fetch(`/api/rich-presets/${preset.id}/lorebooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lorebookIds: [...current] }),
    });
    router.refresh();
  }

  function updateSampler(field: keyof RichPresetJson, value: number) {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
  }

  function updatePrompt(identifier: string, patch: Partial<RichPromptEntry>) {
    if (!draft) return;
    const prompts = draft.prompts.map((p) =>
      p.identifier === identifier ? { ...p, ...patch } : p
    );
    setDraft({ ...draft, prompts });
  }

  function toggleEnabled(identifier: string) {
    if (!draft) return;
    const order = draft.prompt_order[0].order.map((o) =>
      o.identifier === identifier ? { ...o, enabled: !o.enabled } : o
    );
    const prompt_order = [{ ...draft.prompt_order[0], order }, ...draft.prompt_order.slice(1)];
    setDraft({ ...draft, prompt_order });
  }

  function movePrompt(identifier: string, dir: -1 | 1) {
    if (!draft) return;
    const order = [...draft.prompt_order[0].order];
    const index = order.findIndex((o) => o.identifier === identifier);
    const target = index + dir;
    if (index === -1 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    const prompt_order = [{ ...draft.prompt_order[0], order }, ...draft.prompt_order.slice(1)];
    setDraft({ ...draft, prompt_order });
  }

  function addPrompt() {
    if (!draft) return;
    const identifier = `custom-${Date.now()}`;
    const prompts = [
      ...draft.prompts,
      { identifier, name: "New prompt", role: "system" as const, content: "" },
    ];
    const order = [...draft.prompt_order[0].order, { identifier, enabled: true }];
    const prompt_order = [{ ...draft.prompt_order[0], order }, ...draft.prompt_order.slice(1)];
    setDraft({ ...draft, prompts, prompt_order });
  }

  function deletePrompt(identifier: string) {
    if (!draft) return;
    const prompts = draft.prompts.filter((p) => p.identifier !== identifier);
    const order = draft.prompt_order[0].order.filter((o) => o.identifier !== identifier);
    const prompt_order = [{ ...draft.prompt_order[0], order }, ...draft.prompt_order.slice(1)];
    setDraft({ ...draft, prompts, prompt_order });
  }

  const orderedEntries =
    draft?.prompt_order[0].order.map((o) => ({
      order: o,
      entry: draft.prompts.find((p) => p.identifier === o.identifier) ?? null,
    })) ?? [];

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside className="flex w-56 flex-col gap-3 overflow-y-auto">
        <div className="text-xs font-medium tracking-wide text-text-muted">SILLYTAVERN PRESETS</div>
        <div className="flex flex-col gap-1">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => select(p)}
              className={`rounded-control px-2 py-1.5 text-left text-sm text-text-main hover:bg-bg-subtle ${
                selectedId === p.id ? "bg-bg-subtle font-medium" : ""
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <label className="cursor-pointer rounded-control border border-dashed border-border p-2 text-center text-xs text-text-muted hover:bg-bg-subtle">
          + Import preset JSON
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />
        </label>
        {importError && <p className="text-xs text-error">{importError}</p>}
      </aside>

      {preset && draft ? (
        <div className="flex min-w-0 flex-1 gap-4 overflow-hidden">
          <div className="flex w-72 flex-col gap-3 overflow-y-auto rounded-card border border-border bg-card p-4">
            <div className="text-xs font-medium tracking-wide text-text-muted">SAMPLER PARAMS</div>
            {SAMPLER_FIELDS.map((field) => (
              <label key={field} className="text-xs text-text-muted">
                {field}
                <input
                  type="number"
                  step="any"
                  value={typeof draft[field] === "number" ? (draft[field] as number) : ""}
                  onChange={(e) => updateSampler(field, Number(e.target.value))}
                  className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-1.5 text-sm text-text-main"
                />
              </label>
            ))}
            <label className="text-xs text-text-muted">
              Character name ({"{{char}}"})
              <input
                value={charName}
                onChange={(e) => setCharName(e.target.value)}
                className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-1.5 text-sm text-text-main"
              />
            </label>
            <label className="text-xs text-text-muted">
              Persona name ({"{{user}}"})
              <input
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-1.5 text-sm text-text-main"
              />
            </label>
            <div className="text-xs font-medium tracking-wide text-text-muted">LOREBOOKS</div>
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
            <div className="mt-2 flex gap-2">
              <button
                onClick={save}
                className="rounded-control bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover"
              >
                Save
              </button>
              <button
                onClick={remove}
                className="rounded-control px-3 py-1.5 text-sm text-error hover:bg-bg-subtle"
              >
                Delete preset
              </button>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto rounded-card border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium tracking-wide text-text-muted">PROMPTS</div>
              <button onClick={addPrompt} className="text-xs text-accent hover:underline">
                + New prompt
              </button>
            </div>
            {orderedEntries.map(({ order, entry }) =>
              entry ? (
                <RichPresetPromptRow
                  key={order.identifier}
                  entry={entry}
                  enabled={order.enabled}
                  onToggle={() => toggleEnabled(entry.identifier)}
                  onChange={(patch) => updatePrompt(entry.identifier, patch)}
                  onMoveUp={() => movePrompt(entry.identifier, -1)}
                  onMoveDown={() => movePrompt(entry.identifier, 1)}
                  onDelete={() => deletePrompt(entry.identifier)}
                />
              ) : null
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-1 items-center justify-center text-sm text-text-muted">
          Import a SillyTavern preset JSON to get started.
        </div>
      )}
    </div>
  );
}
