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
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-widest text-text-muted uppercase">
          Lorebooks
        </span>
        <button
          onClick={onNew}
          className="rounded-control px-1.5 py-0.5 text-xs text-accent transition-colors hover:bg-primary-soft"
        >
          + New
        </button>
      </div>
      {lorebooks.length === 0 ? (
        <p className="px-1 text-xs leading-relaxed text-text-muted">
          None yet. Lorebooks inject world info when keywords appear in the chat.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {lorebooks.map((l) => (
            <button
              key={l.id}
              onClick={() => onSelect(l)}
              className={cn(
                "flex items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm text-text-main transition-colors hover:bg-bg-subtle",
                selectedId === l.id && "bg-bg-subtle font-medium",
                !l.enabled && "opacity-50"
              )}
            >
              <span className="truncate">{l.name}</span>
              <span className="shrink-0 rounded-full bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                {l.scope}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
