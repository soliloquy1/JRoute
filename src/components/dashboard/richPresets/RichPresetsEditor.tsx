// src/components/dashboard/richPresets/RichPresetsEditor.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RichPreset } from "@/lib/db/types.ts";
import type { RichPresetJson, RichPromptEntry } from "@/lib/prompts/stPresetSchema.ts";
import type { Lorebook } from "@/lib/db/types.ts";
import { RichPresetPromptRow } from "./RichPresetPromptRow.tsx";
import { PrimaryButton, DangerButton, Field, inputClass, InlineError } from "../ui.tsx";
import { cn } from "@/lib/cn.ts";

const SAMPLER_FIELDS: Array<{ key: keyof RichPresetJson; label: string; hint?: string }> = [
  { key: "temperature", label: "Temperature" },
  { key: "top_p", label: "Top P" },
  { key: "top_k", label: "Top K" },
  { key: "top_a", label: "Top A" },
  { key: "min_p", label: "Min P" },
  { key: "repetition_penalty", label: "Repetition penalty" },
  { key: "frequency_penalty", label: "Frequency penalty" },
  { key: "presence_penalty", label: "Presence penalty" },
  { key: "seed", label: "Seed", hint: "-1 = random" },
  { key: "n", label: "N (candidates)" },
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function select(p: RichPreset) {
    setSelectedId(p.id);
    setDraft(p.raw);
    setCharName(p.charName);
    setUserName(p.userName);
    setImportError(null);
    setSaveState("idle");
  }

  async function handleImport(file: File) {
    setImportError(null);
    setImporting(true);
    const text = await file.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setImporting(false);
      setImportError("Not valid JSON");
      return;
    }
    const res = await fetch("/api/rich-presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: file.name.replace(/\.json$/i, ""), raw }),
    });
    setImporting(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setImportError(body?.error?.message ?? "Import failed");
      return;
    }
    // Select the freshly imported preset so the editor opens on it immediately. The new
    // row only exists server-side until router.refresh() lands, so fetch it directly and
    // load the draft from the response — setting selectedId alone would leave `draft`
    // pointing at whatever preset was previously open, and a Save would then clobber the
    // new preset with the old one's content.
    const { id } = (await res.json()) as { id: number };
    const created = await fetch(`/api/rich-presets/${id}`);
    if (created.ok) {
      select((await created.json()) as RichPreset);
    } else {
      setSelectedId(id);
    }
    router.refresh();
  }

  async function save() {
    if (!preset || !draft) return;
    setSaveState("saving");
    const res = await fetch(`/api/rich-presets/${preset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: draft, charName, userName }),
    });
    if (!res.ok) {
      setSaveState("error");
      return;
    }
    setSaveState("saved");
    router.refresh();
  }

  async function remove() {
    if (!preset) return;
    if (!window.confirm(`Delete preset "${preset.name}"? Keys using it will fall back to no preset.`))
      return;
    setSaveState("idle");
    const res = await fetch(`/api/rich-presets/${preset.id}`, { method: "DELETE" });
    if (!res.ok) {
      setSaveState("error");
      return;
    }
    setSelectedId(null);
    setDraft(null);
    router.refresh();
  }

  async function toggleLorebook(lorebookId: number) {
    if (!preset) return;
    const current = new Set(preset.lorebookIds);
    if (current.has(lorebookId)) current.delete(lorebookId);
    else current.add(lorebookId);
    const res = await fetch(`/api/rich-presets/${preset.id}/lorebooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lorebookIds: [...current] }),
    });
    if (!res.ok) {
      setSaveState("error");
      return;
    }
    router.refresh();
  }

  function updateSampler(field: keyof RichPresetJson, rawValue: string) {
    if (!draft) return;
    setSaveState("idle");
    // Clearing the field must UNSET the override, not silently become 0 — an
    // authoritative temperature: 0 is a very different thing from "no override".
    // NaN (e.g. a bare "-") is dropped the same way rather than failing the save.
    const next = { ...draft };
    const parsed = rawValue === "" ? NaN : Number(rawValue);
    if (Number.isNaN(parsed)) {
      delete next[field];
    } else {
      (next as Record<string, unknown>)[field] = parsed;
    }
    setDraft(next);
  }

  function updatePrompt(identifier: string, patch: Partial<RichPromptEntry>) {
    if (!draft) return;
    setSaveState("idle");
    const prompts = draft.prompts.map((p) =>
      p.identifier === identifier ? { ...p, ...patch } : p
    );
    setDraft({ ...draft, prompts });
  }

  // Edit the SAME order entry the runtime applies: richAssemble prefers the
  // character_id 100001 (ST default) entry over index 0, so the editor must too —
  // otherwise a multi-entry export would render/edit an order the proxy ignores.
  function activeOrderIndex(d: RichPresetJson): number {
    if (d.prompt_order.length === 0) return -1;
    const idx = d.prompt_order.findIndex((e) => e.character_id === 100001);
    return idx === -1 ? 0 : idx;
  }

  function editOrder(mutate: (order: RichPresetJson["prompt_order"][0]["order"]) => void) {
    if (!draft) return;
    const idx = activeOrderIndex(draft);
    if (idx === -1) return;
    const order = [...draft.prompt_order[idx].order];
    mutate(order);
    const prompt_order = draft.prompt_order.map((e, i) => (i === idx ? { ...e, order } : e));
    setSaveState("idle");
    setDraft({ ...draft, prompt_order });
  }

  function toggleEnabled(identifier: string) {
    editOrder((order) => {
      const item = order.find((o) => o.identifier === identifier);
      if (item) item.enabled = !item.enabled;
    });
  }

  function movePrompt(identifier: string, dir: -1 | 1) {
    editOrder((order) => {
      const index = order.findIndex((o) => o.identifier === identifier);
      const target = index + dir;
      if (index === -1 || target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target], order[index]];
    });
  }

  function addPrompt() {
    if (!draft) return;
    const identifier = `custom-${Date.now()}`;
    const idx = activeOrderIndex(draft);
    setSaveState("idle");
    setDraft({
      ...draft,
      prompts: [
        ...draft.prompts,
        { identifier, name: "New prompt", role: "system" as const, content: "" },
      ],
      prompt_order:
        idx === -1
          ? [{ character_id: 100001, order: [{ identifier, enabled: true }] }]
          : draft.prompt_order.map((e, i) =>
              i === idx ? { ...e, order: [...e.order, { identifier, enabled: true }] } : e
            ),
    });
  }

  function deletePrompt(identifier: string) {
    if (!draft) return;
    setSaveState("idle");
    setDraft({
      ...draft,
      prompts: draft.prompts.filter((p) => p.identifier !== identifier),
      prompt_order: draft.prompt_order.map((entry) => ({
        ...entry,
        order: entry.order.filter((o) => o.identifier !== identifier),
      })),
    });
  }

  const activeIdx = draft ? activeOrderIndex(draft) : -1;
  const orderedEntries =
    draft && activeIdx !== -1
      ? draft.prompt_order[activeIdx].order.map((o) => ({
          order: o,
          entry: draft.prompts.find((p) => p.identifier === o.identifier) ?? null,
        }))
      : (draft?.prompts.map((p) => ({ order: { identifier: p.identifier, enabled: true }, entry: p })) ??
        []);

  const importButton = (
    <>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-control border border-dashed border-border-strong px-3 py-2 text-xs text-text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
      >
        <span className="material-symbols-outlined !text-[16px]">upload_file</span>
        {importing ? "Importing…" : "Import preset JSON"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleImport(file);
        }}
      />
    </>
  );

  return (
    <div className="flex h-[calc(100vh-7.5rem)] gap-4">
      <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
        <span className="text-[11px] font-semibold tracking-widest text-text-muted uppercase">
          SillyTavern presets
        </span>
        {presets.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => select(p)}
                className={cn(
                  "rounded-control px-2 py-1.5 text-left text-sm text-text-main transition-colors hover:bg-bg-subtle",
                  selectedId === p.id && "bg-bg-subtle font-medium"
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        {importButton}
        <InlineError message={importError} />
      </aside>

      {preset && draft ? (
        <div className="flex min-w-0 flex-1 gap-4 overflow-hidden">
          <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-card border border-border bg-card p-4 shadow-soft">
            <span className="text-[11px] font-semibold tracking-widest text-text-muted uppercase">
              Sampler params
            </span>
            <p className="text-[11px] leading-relaxed text-text-muted">
              These override whatever the client sends.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SAMPLER_FIELDS.map(({ key, label }) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    step="any"
                    value={typeof draft[key] === "number" ? (draft[key] as number) : ""}
                    onChange={(e) => updateSampler(key, e.target.value)}
                    className={`${inputClass} font-mono text-[13px]`}
                  />
                </Field>
              ))}
            </div>
            <Field label="Character name ({{char}})">
              <input
                value={charName}
                onChange={(e) => {
                  setCharName(e.target.value);
                  setSaveState("idle");
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Persona name ({{user}})">
              <input
                value={userName}
                onChange={(e) => {
                  setUserName(e.target.value);
                  setSaveState("idle");
                }}
                className={inputClass}
              />
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
            <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
              <PrimaryButton onClick={save} disabled={saveState === "saving"}>
                {saveState === "saving" ? "Saving…" : "Save"}
              </PrimaryButton>
              {saveState === "saved" && (
                <span className="text-xs text-success">Saved</span>
              )}
              {saveState === "error" && (
                <span className="text-xs text-error">Save failed — try again</span>
              )}
              <span className="ml-auto">
                <DangerButton onClick={remove}>Delete preset</DangerButton>
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto rounded-card border border-border bg-card p-4 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-widest text-text-muted uppercase">
                Prompts · in injection order
              </span>
              <button
                onClick={addPrompt}
                className="rounded-control px-1.5 py-0.5 text-xs text-accent transition-colors hover:bg-primary-soft"
              >
                + New prompt
              </button>
            </div>
            {orderedEntries.map(({ order, entry }, index) =>
              entry ? (
                <RichPresetPromptRow
                  key={order.identifier}
                  entry={entry}
                  enabled={order.enabled}
                  canMoveUp={index > 0}
                  canMoveDown={index < orderedEntries.length - 1}
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
        <div className="flex flex-1 items-center justify-center rounded-card border border-dashed border-border-strong">
          <div className="flex max-w-sm flex-col items-center gap-2 text-center">
            <span className="material-symbols-outlined !text-[32px] text-text-muted">tune</span>
            <div className="text-sm font-medium text-text-main">
              {presets.length === 0 ? "Import your first SillyTavern preset" : "Select a preset"}
            </div>
            <p className="text-xs leading-relaxed text-text-muted">
              {presets.length === 0
                ? "Export a prompt preset from SillyTavern (Prompt Manager → export) and drop the JSON in here. Its prompt order, sampler settings, and macros become the pipeline your chats run through."
                : "Pick a preset from the list, or import another JSON export."}
            </p>
            <div className="mt-2 w-56">{importButton}</div>
            <InlineError message={importError} />
          </div>
        </div>
      )}
    </div>
  );
}
