// src/components/dashboard/prompts/LorebookList.tsx
"use client";

import type { Lorebook } from "@/lib/db/types.ts";
import { cn } from "@/lib/cn.ts";

export function LorebookList({
  lorebooks,
  selectedId,
  onSelect,
  onNew,
}: {
  lorebooks: Lorebook[];
  selectedId: number | null;
  onSelect: (l: Lorebook) => void;
  onNew: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-text-muted">LOREBOOKS</span>
        <button onClick={onNew} className="text-xs text-accent hover:underline">
          + New
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {lorebooks.map((l) => (
          <button
            key={l.id}
            onClick={() => onSelect(l)}
            className={cn(
              "rounded-control px-2 py-1.5 text-left text-sm text-text-main hover:bg-bg-subtle",
              selectedId === l.id && "bg-bg-subtle font-medium",
              !l.enabled && "opacity-50"
            )}
          >
            {l.name} <span className="text-xs text-text-muted">({l.scope})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
