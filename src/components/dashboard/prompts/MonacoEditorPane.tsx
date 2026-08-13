// src/components/dashboard/prompts/MonacoEditorPane.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as monaco from "monaco-editor";
import Editor, { loader } from "@monaco-editor/react";

// Self-host Monaco from the npm package instead of the default jsdelivr CDN loader:
// this repo's CSP (next.config.mjs) is `script-src 'self' ... blob:` with no CDN origin,
// so the default loader script is refused and the editor never initializes.
loader.config({ monaco });
import type { PromptBlock, Lorebook, PromptBlockKind, LorebookScope } from "@/lib/db/types.ts";
import { PrimaryButton, GhostButton, DangerButton, Field, inputClass } from "../ui.tsx";
import { useIsDark } from "@/lib/useTheme.ts";

export type EditorSelection =
  | { kind: "block"; item: PromptBlock | null }
  | { kind: "lorebook"; item: Lorebook | null };

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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Monaco follows the UI theme ("vs" / "vs-dark") via the shared hydration-safe hook.
  const editorTheme = useIsDark() ? "vs-dark" : "vs";

  // Selection changes reset this pane's state via a `key` prop at the call site
  // (PromptsEditor) — remount-on-change instead of a setState-in-effect, which this
  // repo's lint config (react-hooks/set-state-in-effect) rejects as an error.

  async function save() {
    setSaving(true);
    setError(null);
    let res: Response;
    if (selection.kind === "block") {
      res = selection.item
        ? await fetch(`/api/prompt-blocks/${selection.item.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, content }),
          })
        : await fetch("/api/prompt-blocks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, kind: blockKind, content }),
          });
    } else {
      res = selection.item
        ? await fetch(`/api/lorebooks/${selection.item.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, source: content, scope, enabled }),
          })
        : await fetch("/api/lorebooks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, source: content, scope, enabled }),
          });
    }
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "Save failed");
      return;
    }
    router.refresh();
    onDone();
  }

  async function remove() {
    if (!selection.item) return;
    if (!window.confirm(`Delete "${selection.item.name}"?`)) return;
    setError(null);
    const path =
      selection.kind === "block"
        ? `/api/prompt-blocks/${selection.item.id}`
        : `/api/lorebooks/${selection.item.id}`;
    const res = await fetch(path, { method: "DELETE" });
    if (!res.ok) {
      setError("Delete failed");
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="flex h-full flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-soft">
      <div className="flex items-end gap-3">
        <Field label={selection.kind === "block" ? "Block name" : "Lorebook name"} className="flex-1">
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>
        {selection.kind === "block" && (
          <Field label="Position">
            <select
              value={blockKind}
              onChange={(e) => setBlockKind(e.target.value as PromptBlockKind)}
              className={inputClass}
            >
              <option value="prepend">prepend</option>
              <option value="append">append</option>
            </select>
          </Field>
        )}
        {selection.kind === "lorebook" && (
          <>
            <Field label="Scope">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as LorebookScope)}
                className={inputClass}
              >
                <option value="character">character</option>
                <option value="global">global</option>
              </select>
            </Field>
            <label className="flex h-[34px] items-center gap-1.5 text-sm text-text-main">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="accent-primary"
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
          theme={editorTheme}
          value={content}
          onChange={(v) => setContent(v ?? "")}
          options={{ minimap: { enabled: false }, fontSize: 12.5, padding: { top: 10 } }}
        />
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex items-center gap-2">
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </PrimaryButton>
        <GhostButton onClick={onDone}>Cancel</GhostButton>
        {selection.item && (
          <span className="ml-auto">
            <DangerButton onClick={remove}>Delete</DangerButton>
          </span>
        )}
      </div>
    </div>
  );
}
