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
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-widest text-text-muted uppercase">
          Prompt blocks
        </span>
        <button
          onClick={onNew}
          className="rounded-control px-1.5 py-0.5 text-xs text-accent transition-colors hover:bg-primary-soft"
        >
          + New
        </button>
      </div>
      {blocks.length === 0 ? (
        <p className="px-1 text-xs leading-relaxed text-text-muted">
          None yet. Blocks are reusable text injected before or after the chat.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {blocks.map((b) => (
            <button
              key={b.id}
              onClick={() => onSelect(b)}
              className={cn(
                "flex items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm text-text-main transition-colors hover:bg-bg-subtle",
                selectedId === b.id && "bg-bg-subtle font-medium"
              )}
            >
              <span className="truncate">{b.name}</span>
              <span className="shrink-0 rounded-full bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                {b.kind}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
