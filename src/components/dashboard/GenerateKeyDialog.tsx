// src/components/dashboard/GenerateKeyDialog.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, GhostButton, Field, inputClass, InlineError } from "./ui.tsx";

const TOOL_MODES = ["off", "trigger", "native"] as const;

export function GenerateKeyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [toolMode, setToolMode] = useState<(typeof TOOL_MODES)[number]>("off");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    setCopied(false);
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setError("Could not copy — select and copy the key manually.");
    }
  }

  if (!open) {
    return <PrimaryButton onClick={() => setOpen(true)}>Generate key</PrimaryButton>;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={secret ? "Key generated" : "Generate API key"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // No backdrop-dismiss while the one-time secret is on screen — a stray click
        // must not destroy the only copy the operator will ever see.
        if (!secret && e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (!secret && e.key === "Escape") close();
      }}
    >
      <div className="w-full max-w-md rounded-card border border-border bg-card p-5 shadow-elevated">
        {secret ? (
          <>
            <div className="mb-1 text-sm font-semibold text-text-main">Key generated</div>
            <p className="mb-3 text-xs leading-relaxed text-text-muted">
              Copy this now — it will not be shown again.
            </p>
            <code className="block break-all rounded-control border border-border bg-bg p-3 font-mono text-xs leading-relaxed text-text-main select-all">
              {secret}
            </code>
            <InlineError message={error} />
            <div className="mt-4 flex justify-end gap-2">
              <GhostButton onClick={copySecret}>{copied ? "Copied" : "Copy"}</GhostButton>
              <PrimaryButton onClick={close}>Done</PrimaryButton>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="text-sm font-semibold text-text-main">Generate API key</div>
            <Field label="Label">
              <input
                placeholder="e.g. sillytavern-desktop"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className={inputClass}
                autoFocus
              />
            </Field>
            <Field label="Tool mode">
              <select
                value={toolMode}
                onChange={(e) => setToolMode(e.target.value as (typeof TOOL_MODES)[number])}
                className={inputClass}
              >
                {TOOL_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <InlineError message={error} />
            <div className="mt-1 flex justify-end gap-2">
              <GhostButton type="button" onClick={close}>
                Cancel
              </GhostButton>
              <PrimaryButton type="submit">Generate</PrimaryButton>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
