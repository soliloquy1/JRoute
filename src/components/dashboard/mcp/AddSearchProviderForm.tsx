// src/components/dashboard/mcp/AddSearchProviderForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, Field, inputClass, InlineError } from "../ui.tsx";

const KINDS = ["brave", "serpapi", "google_cse", "tavily"] as const;
type Kind = (typeof KINDS)[number];

export function AddSearchProviderForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("brave");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [cx, setCx] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const configJson =
      kind === "google_cse" && cx.trim() ? JSON.stringify({ cx: cx.trim() }) : undefined;
    const res = await fetch("/api/search-providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, label, apiKey, configJson }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "Failed to add provider");
      return;
    }
    setOpen(false);
    setLabel("");
    setApiKey("");
    setCx("");
    router.refresh();
  }

  if (!open) {
    return <PrimaryButton onClick={() => setOpen(true)}>Add provider</PrimaryButton>;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-md flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-soft"
    >
      <div className="text-sm font-semibold text-text-main">New search provider</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className={inputClass}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label">
          <input
            placeholder="My Brave Key"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="API key">
        <input
          type="password"
          placeholder="••••••••"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className={inputClass}
        />
      </Field>
      {kind === "google_cse" && (
        <Field label="Custom Search Engine ID (cx)">
          <input
            placeholder="abc123"
            value={cx}
            onChange={(e) => setCx(e.target.value)}
            className={inputClass}
          />
        </Field>
      )}
      <InlineError message={error} />
      <div className="flex gap-2">
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save provider"}
        </PrimaryButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-control border border-border px-2.5 py-1 text-xs text-text-main transition-colors hover:bg-bg-subtle"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
