// src/components/dashboard/AddProviderForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, GhostButton, Field, inputClass, InlineError } from "./ui.tsx";

const WIRE_FORMATS = ["openai", "anthropic", "gemini"] as const;
const KINDS = ["apikey", "oauth"] as const;

export function AddProviderForm() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [wireFormat, setWireFormat] = useState<(typeof WIRE_FORMATS)[number]>("openai");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("apikey");
  const [modelPrefix, setModelPrefix] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name, baseUrl, wireFormat, kind, enabled: true, modelPrefix }),
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
    setId("");
    setName("");
    setBaseUrl("");
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
      <div className="text-sm font-semibold text-text-main">New provider</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ID">
          <input
            placeholder="openai"
            value={id}
            onChange={(e) => setId(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Display name">
          <input
            placeholder="OpenAI"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Base URL">
        <input
          placeholder="https://api.openai.com/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className={`${inputClass} font-mono text-[13px]`}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wire format">
          <select
            value={wireFormat}
            onChange={(e) => setWireFormat(e.target.value as (typeof WIRE_FORMATS)[number])}
            className={inputClass}
          >
            {WIRE_FORMATS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Auth kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
            className={inputClass}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Model prefix (optional)">
        <input
          placeholder="or  (requests become or/modelname)"
          value={modelPrefix}
          onChange={(e) => setModelPrefix(e.target.value)}
          className={`${inputClass} font-mono text-[13px]`}
        />
      </Field>
      <InlineError message={error} />
      <div className="flex gap-2">
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save provider"}
        </PrimaryButton>
        <GhostButton type="button" onClick={() => setOpen(false)}>
          Cancel
        </GhostButton>
      </div>
    </form>
  );
}
