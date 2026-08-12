// src/components/dashboard/prompts/PromptsEditor.tsx
"use client";

import { useState } from "react";
import type { PromptBlock, Lorebook, Preset } from "@/lib/db/types.ts";
import { BlockList } from "./BlockList.tsx";
import { LorebookList } from "./LorebookList.tsx";
import { MonacoEditorPane, type EditorSelection } from "./MonacoEditorPane.tsx";
import { PresetForm } from "./PresetForm.tsx";
import { PreviewPanel } from "./PreviewPanel.tsx";

export function PromptsEditor({
  blocks,
  lorebooks,
  presets,
}: {
  blocks: PromptBlock[];
  lorebooks: Lorebook[];
  presets: Preset[];
}) {
  const [selection, setSelection] = useState<EditorSelection | null>(null);

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside className="flex w-56 flex-col gap-4 overflow-y-auto">
        <BlockList
          blocks={blocks}
          selectedId={selection?.kind === "block" ? (selection.item?.id ?? null) : null}
          onSelect={(b) => setSelection({ kind: "block", item: b })}
          onNew={() => setSelection({ kind: "block", item: null })}
        />
        <LorebookList
          lorebooks={lorebooks}
          selectedId={selection?.kind === "lorebook" ? (selection.item?.id ?? null) : null}
          onSelect={(l) => setSelection({ kind: "lorebook", item: l })}
          onNew={() => setSelection({ kind: "lorebook", item: null })}
        />
      </aside>
      <div className="min-w-0 flex-1">
        {selection ? (
          <MonacoEditorPane
            key={`${selection.kind}-${selection.item?.id ?? "new"}`}
            selection={selection}
            onDone={() => setSelection(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            Select a block or lorebook to edit, or create a new one.
          </div>
        )}
      </div>
      <aside className="flex w-96 flex-col gap-4 overflow-y-auto">
        <PresetForm presets={presets} blocks={blocks} lorebooks={lorebooks} />
        <PreviewPanel presets={presets} />
      </aside>
    </div>
  );
}
