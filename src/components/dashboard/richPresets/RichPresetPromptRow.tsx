// src/components/dashboard/richPresets/RichPresetPromptRow.tsx
"use client";

import type { RichPromptEntry } from "@/lib/prompts/stPresetSchema.ts";

export function RichPresetPromptRow({
  entry,
  enabled,
  onToggle,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  entry: RichPromptEntry;
  enabled: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<RichPromptEntry>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-control border border-border p-2">
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={onToggle} />
        <input
          value={entry.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="flex-1 rounded-control border border-border bg-bg-subtle p-1 text-xs text-text-main"
        />
        <span className="text-xs text-text-muted">{entry.identifier}</span>
        <button onClick={onMoveUp} className="text-xs text-text-muted hover:text-text-main">
          ↑
        </button>
        <button onClick={onMoveDown} className="text-xs text-text-muted hover:text-text-main">
          ↓
        </button>
        <button onClick={onDelete} className="text-xs text-error hover:underline">
          Delete
        </button>
      </div>
      {!entry.marker && (
        <textarea
          value={entry.content ?? ""}
          onChange={(e) => onChange({ content: e.target.value })}
          rows={3}
          className="w-full rounded-control border border-border bg-bg-subtle p-1.5 text-xs text-text-main"
        />
      )}
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <label>
          Position
          <select
            value={entry.injection_position ?? 0}
            onChange={(e) => onChange({ injection_position: Number(e.target.value) as 0 | 1 })}
            className="ml-1 rounded-control border border-border bg-bg-subtle p-1 text-text-main"
          >
            <option value={0}>relative</option>
            <option value={1}>absolute (depth)</option>
          </select>
        </label>
        {entry.injection_position === 1 && (
          <>
            <label>
              Depth
              <input
                type="number"
                value={entry.injection_depth ?? 0}
                onChange={(e) => onChange({ injection_depth: Number(e.target.value) })}
                className="ml-1 w-16 rounded-control border border-border bg-bg-subtle p-1 text-text-main"
              />
            </label>
            <label>
              Order
              <input
                type="number"
                value={entry.injection_order ?? 100}
                onChange={(e) => onChange({ injection_order: Number(e.target.value) })}
                className="ml-1 w-16 rounded-control border border-border bg-bg-subtle p-1 text-text-main"
              />
            </label>
          </>
        )}
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={entry.forbid_overrides ?? false}
            onChange={(e) => onChange({ forbid_overrides: e.target.checked })}
          />
          forbid overrides
        </label>
      </div>
    </div>
  );
}
