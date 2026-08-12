// src/components/dashboard/AddConnectionForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddConnectionForm({ providerId }: { providerId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [open, setOpen] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId, label, apiKey }),
    });
    if (!res.ok) {
      console.error("Failed to add connection", providerId, label);
      return;
    }
    setOpen(false);
    setLabel("");
    setApiKey("");
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-accent hover:underline">
        + Add connection
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2">
      <input
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      />
      <input
        placeholder="API key"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-control bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-control px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
