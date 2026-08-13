// src/components/dashboard/AddConnectionForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, GhostButton, Field, inputClass, InlineError } from "./ui.tsx";

export function AddConnectionForm({ providerId }: { providerId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId, label, apiKey }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "Failed to add connection");
      return;
    }
    setOpen(false);
    setLabel("");
    setApiKey("");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-control px-2 py-1 text-xs text-accent transition-colors hover:bg-primary-soft"
      >
        + Add connection
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-control border border-border bg-bg p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Label">
          <input
            placeholder="primary"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="API key">
          <input
            placeholder="sk-…"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={`${inputClass} font-mono text-[13px]`}
            autoComplete="off"
          />
        </Field>
      </div>
      <InlineError message={error} />
      <div className="flex gap-2">
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </PrimaryButton>
        <GhostButton type="button" onClick={() => setOpen(false)}>
          Cancel
        </GhostButton>
      </div>
    </form>
  );
}
