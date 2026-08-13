// src/components/dashboard/richPresets/RichPresetPromptRow.tsx
"use client";

import type { RichPromptEntry } from "@/lib/prompts/stPresetSchema.ts";
import { cn } from "@/lib/cn.ts";

const iconBtn =
  "flex h-6 w-6 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-bg-subtle hover:text-text-main disabled:opacity-30 disabled:hover:bg-transparent";

export function RichPresetPromptRow({
  entry,
  enabled,
  canMoveUp,
  canMoveDown,
  onToggle,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  entry: RichPromptEntry;
  enabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<RichPromptEntry>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-control border border-border bg-bg p-2.5 transition-opacity",
        !enabled && "opacity-50"
      )}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="accent-primary"
          title={enabled ? "Enabled" : "Disabled"}
        />
        <input
          value={entry.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-medium text-text-main transition-colors hover:border-border-strong focus:border-primary focus:bg-card"
        />
        <span className="shrink-0 font-mono text-[10px] text-text-muted">{entry.identifier}</span>
        {entry.marker && (
          <span className="shrink-0 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">
            marker
          </span>
        )}
        <button
          onClick={onMoveUp}
          disabled={!canMoveUp}
          className={iconBtn}
          title="Move up"
          aria-label={`Move ${entry.name || entry.identifier} up`}
        >
          <span className="material-symbols-outlined !text-[16px]">arrow_upward</span>
        </button>
        <button
          onClick={onMoveDown}
          disabled={!canMoveDown}
          className={iconBtn}
          title="Move down"
          aria-label={`Move ${entry.name || entry.identifier} down`}
        >
          <span className="material-symbols-outlined !text-[16px]">arrow_downward</span>
        </button>
        <button
          onClick={onDelete}
          className="flex h-6 w-6 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-error/10 hover:text-error"
          title="Delete prompt"
          aria-label={`Delete ${entry.name || entry.identifier}`}
        >
          <span className="material-symbols-outlined !text-[16px]">delete</span>
        </button>
      </div>
      {!entry.marker && (
        <textarea
          value={entry.content ?? ""}
          onChange={(e) => onChange({ content: e.target.value })}
          rows={3}
          placeholder="Prompt content — {{char}} and {{user}} are substituted"
          className="w-full rounded-control border border-border-strong bg-card px-2 py-1.5 font-mono text-xs leading-relaxed text-text-main placeholder:text-text-muted/60 focus:border-primary"
        />
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
        <label className="flex items-center gap-1.5">
          Position
          <select
            value={entry.injection_position ?? 0}
            onChange={(e) => onChange({ injection_position: Number(e.target.value) as 0 | 1 })}
            className="rounded-control border border-border-strong bg-card px-1.5 py-0.5 text-text-main"
          >
            <option value={0}>relative</option>
            <option value={1}>depth</option>
          </select>
        </label>
        {entry.injection_position === 1 && (
          <>
            <label className="flex items-center gap-1.5">
              Depth
              <input
                type="number"
                min={0}
                value={entry.injection_depth ?? 0}
                onChange={(e) => onChange({ injection_depth: Number(e.target.value) })}
                className="w-16 rounded-control border border-border-strong bg-card px-1.5 py-0.5 font-mono text-text-main"
              />
            </label>
            <label className="flex items-center gap-1.5">
              Order
              <input
                type="number"
                value={entry.injection_order ?? 100}
                onChange={(e) => onChange({ injection_order: Number(e.target.value) })}
                className="w-16 rounded-control border border-border-strong bg-card px-1.5 py-0.5 font-mono text-text-main"
              />
            </label>
          </>
        )}
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={entry.forbid_overrides ?? false}
            onChange={(e) => onChange({ forbid_overrides: e.target.checked })}
            className="accent-primary"
          />
          forbid overrides
        </label>
      </div>
    </div>
  );
}
