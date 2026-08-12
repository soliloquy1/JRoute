// src/components/dashboard/prompts/BlockList.tsx
"use client";

import type { PromptBlock } from "@/lib/db/types.ts";
import { cn } from "@/lib/cn.ts";

export function BlockList({
  blocks,
  selectedId,
  onSelect,
  onNew,
}: {
  blocks: PromptBlock[];
  selectedId: number | null;
  onSelect: (b: PromptBlock) => void;
  onNew: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-text-muted">PROMPT BLOCKS</span>
        <button onClick={onNew} className="text-xs text-accent hover:underline">
          + New
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {blocks.map((b) => (
          <button
            key={b.id}
            onClick={() => onSelect(b)}
            className={cn(
              "rounded-control px-2 py-1.5 text-left text-sm text-text-main hover:bg-bg-subtle",
              selectedId === b.id && "bg-bg-subtle font-medium"
            )}
          >
            {b.name} <span className="text-xs text-text-muted">({b.kind})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
