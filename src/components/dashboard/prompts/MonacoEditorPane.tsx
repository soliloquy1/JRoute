// src/components/dashboard/prompts/MonacoEditorPane.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import * as monaco from "monaco-editor";
import Editor, { loader } from "@monaco-editor/react";

// Self-host Monaco from the npm package instead of the default jsdelivr CDN loader:
// this repo's CSP (next.config.mjs) is `script-src 'self' ... blob:` with no CDN origin,
// so the default loader script is refused and the editor never initializes.
loader.config({ monaco });
import type { PromptBlock, Lorebook, PromptBlockKind, LorebookScope } from "@/lib/db/types.ts";

export type EditorSelection =
  { kind: "block"; item: PromptBlock | null } | { kind: "lorebook"; item: Lorebook | null };

export function MonacoEditorPane({
  selection,
  onDone,
}: {
  selection: EditorSelection;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(selection.item?.name ?? "");
  const [content, setContent] = useState(
    selection.kind === "block" ? (selection.item?.content ?? "") : (selection.item?.source ?? "")
  );
  const [blockKind, setBlockKind] = useState<PromptBlockKind>(
    selection.kind === "block" ? (selection.item?.kind ?? "prepend") : "prepend"
  );
  const [scope, setScope] = useState<LorebookScope>(
    selection.kind === "lorebook" ? (selection.item?.scope ?? "character") : "character"
  );
  const [enabled, setEnabled] = useState(
    selection.kind === "lorebook" ? (selection.item?.enabled ?? true) : true
  );

  useEffect(() => {
    setName(selection.item?.name ?? "");
    setContent(
      selection.kind === "block" ? (selection.item?.content ?? "") : (selection.item?.source ?? "")
    );
    if (selection.kind === "block") setBlockKind(selection.item?.kind ?? "prepend");
    if (selection.kind === "lorebook") {
      setScope(selection.item?.scope ?? "character");
      setEnabled(selection.item?.enabled ?? true);
    }
  }, [selection]);

  async function save() {
    if (selection.kind === "block") {
      if (selection.item) {
        await fetch(`/api/prompt-blocks/${selection.item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, content }),
        });
      } else {
        await fetch("/api/prompt-blocks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, kind: blockKind, content }),
        });
      }
    } else {
      if (selection.item) {
        await fetch(`/api/lorebooks/${selection.item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, source: content, scope, enabled }),
        });
      } else {
        await fetch("/api/lorebooks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, source: content, scope, enabled }),
        });
      }
    }
    router.refresh();
    onDone();
  }

  async function remove() {
    if (!selection.item) return;
    const path =
      selection.kind === "block"
        ? `/api/prompt-blocks/${selection.item.id}`
        : `/api/lorebooks/${selection.item.id}`;
    await fetch(path, { method: "DELETE" });
    router.refresh();
    onDone();
  }

  return (
    <div className="flex h-full flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
        />
        {selection.kind === "block" && (
          <select
            value={blockKind}
            onChange={(e) => setBlockKind(e.target.value as PromptBlockKind)}
            className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
          >
            <option value="prepend">prepend</option>
            <option value="append">append</option>
          </select>
        )}
        {selection.kind === "lorebook" && (
          <>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as LorebookScope)}
              className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
            >
              <option value="character">character</option>
              <option value="global">global</option>
            </select>
            <label className="flex items-center gap-1 text-sm text-text-main">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              enabled
            </label>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-control border border-border">
        <Editor
          height="100%"
          language={selection.kind === "lorebook" ? "javascript" : "plaintext"}
          theme="vs-dark"
          value={content}
          onChange={(v) => setContent(v ?? "")}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          className="rounded-control bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover"
        >
          Save
        </button>
        {selection.item && (
          <button
            onClick={remove}
            className="rounded-control px-3 py-1.5 text-sm text-error hover:bg-bg-subtle"
          >
            Delete
          </button>
        )}
        <button
          onClick={onDone}
          className="rounded-control px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
