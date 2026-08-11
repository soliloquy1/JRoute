// src/components/dashboard/AddProviderForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const WIRE_FORMATS = ["openai", "anthropic", "gemini"] as const;
const KINDS = ["apikey", "oauth"] as const;

export function AddProviderForm() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [wireFormat, setWireFormat] = useState<(typeof WIRE_FORMATS)[number]>("openai");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("apikey");
  const [open, setOpen] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name, baseUrl, wireFormat, kind, enabled: true }),
    });
    setOpen(false);
    setId("");
    setName("");
    setBaseUrl("");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-control bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover"
      >
        Add provider
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-card border border-border bg-card p-4"
    >
      <input
        placeholder="id (e.g. openai)"
        value={id}
        onChange={(e) => setId(e.target.value)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      />
      <input
        placeholder="Display name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      />
      <input
        placeholder="Base URL"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      />
      <select
        value={wireFormat}
        onChange={(e) => setWireFormat(e.target.value as (typeof WIRE_FORMATS)[number])}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      >
        {WIRE_FORMATS.map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
      </select>
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
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
