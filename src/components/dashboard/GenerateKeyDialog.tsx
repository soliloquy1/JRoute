// src/components/dashboard/GenerateKeyDialog.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TOOL_MODES = ["off", "trigger", "native"] as const;

export function GenerateKeyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [toolMode, setToolMode] = useState<(typeof TOOL_MODES)[number]>("off");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, toolMode }),
    });
    if (!res.ok) {
      setError("Failed to generate key. Please try again.");
      return;
    }
    const body = (await res.json()) as { secret: string };
    setSecret(body.secret);
    router.refresh();
  }

  function close() {
    setOpen(false);
    setSecret(null);
    setError(null);
    setLabel("");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-control bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover"
      >
        Generate key
      </button>
    );
  }

  if (secret) {
    return (
      <div className="rounded-card border border-border bg-card p-4">
        <p className="mb-2 text-sm text-text-main">Copy this now — it will not be shown again:</p>
        <code className="block break-all rounded-control bg-bg-subtle p-2 text-xs text-text-main">
          {secret}
        </code>
        <button
          onClick={close}
          className="mt-3 rounded-control px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-card border border-border bg-card p-4"
    >
      <input
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      />
      <select
        value={toolMode}
        onChange={(e) => setToolMode(e.target.value as (typeof TOOL_MODES)[number])}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      >
        {TOOL_MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-control bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover"
        >
          Generate
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded-control px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
