// src/components/dashboard/ProviderPrefixEditor.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GhostButton, inputClass, InlineError } from "./ui.tsx";

export function ProviderPrefixEditor({
  providerId,
  prefix,
}: {
  providerId: string;
  prefix: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(prefix);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelPrefix: value }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "Failed to save prefix");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="font-mono text-[11px] text-text-muted hover:text-text-main"
        title="Edit model prefix"
      >
        prefix: {prefix || "(none)"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="or"
          className={`${inputClass} w-24 font-mono text-[11px]`}
        />
        <GhostButton onClick={save} disabled={saving}>
          {saving ? "…" : "Save"}
        </GhostButton>
        <GhostButton onClick={() => setEditing(false)}>Cancel</GhostButton>
      </div>
      <InlineError message={error} />
    </div>
  );
}
