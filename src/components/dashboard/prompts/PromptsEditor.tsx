// src/components/dashboard/prompts/PromptsEditor.tsx
"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { PromptBlock, Lorebook, Preset } from "@/lib/db/types.ts";
import { BlockList } from "./BlockList.tsx";
import { LorebookList } from "./LorebookList.tsx";
import type { EditorSelection } from "./MonacoEditorPane.tsx";
import { PresetForm } from "./PresetForm.tsx";
import { PreviewPanel } from "./PreviewPanel.tsx";

// monaco-editor touches `window` at module scope — importing the pane statically would
// crash server-side rendering of /prompts ("window is not defined"). Client-only.
const MonacoEditorPane = dynamic(
  () => import("./MonacoEditorPane.tsx").then((m) => m.MonacoEditorPane),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center rounded-card border border-border bg-card text-sm text-text-muted">
        Loading editor…
      </div>
    ),
  }
);

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
    <div className="flex h-[calc(100vh-7.5rem)] gap-4">
      <aside className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto pr-1">
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
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border-strong text-center">
            <span className="material-symbols-outlined !text-[28px] text-text-muted">
              edit_note
            </span>
            <p className="text-sm text-text-muted">
              Select a block or lorebook to edit, or create a new one.
            </p>
            <p className="max-w-xs text-[11px] leading-relaxed text-text-muted">
              Prompt blocks are static text prepended/appended to every request. Lorebooks are
              operator-authored scripts that inject entries by keyword.
            </p>
          </div>
        )}
      </div>
      <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto">
        <PresetForm presets={presets} blocks={blocks} lorebooks={lorebooks} />
        <PreviewPanel presets={presets} />
      </aside>
    </div>
  );
}
