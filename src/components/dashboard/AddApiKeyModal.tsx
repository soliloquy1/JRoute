// src/components/dashboard/AddApiKeyModal.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, PrimaryButton, GhostButton, Field, inputClass, InlineError, useToast } from "./ui.tsx";
import { validateAddApiKey } from "./providerFormValidation.ts";

/**
 * Modal to attach an API-key connection to a provider. Replaces the inline
 * AddConnectionForm: validates client-side (label/key required, non-negative integer
 * priority), surfaces errors via a visible Toast (never console.error), and refreshes
 * server state on success.
 */
export function AddApiKeyModal({
  providerId,
  providerName,
  onClose,
}: {
  providerId: string;
  providerName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState("100");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fieldErrors = validateAddApiKey({ label, apiKey, priority });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSaving(true);
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId,
        label: label.trim(),
        apiKey: apiKey.trim(),
        priority: priority.trim() === "" ? 100 : Number(priority),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string } | string;
      } | null;
      const msg =
        typeof body?.error === "string"
          ? body.error
          : body?.error?.message ?? "Failed to add connection";
      toast(msg, "error");
      return;
    }
    toast("Connection added", "ok");
    onClose();
    router.refresh();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add connection · ${providerName}`}
      footer={
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" form="add-apikey-form" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </PrimaryButton>
        </div>
      }
    >
      <form id="add-apikey-form" onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label="Label">
          <input
            className={inputClass}
            placeholder="primary"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <InlineError message={errors.label ?? null} />
        <Field label="API key">
          <input
            className={`${inputClass} font-mono text-[13px]`}
            type="password"
            placeholder="sk-…"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
        <InlineError message={errors.apiKey ?? null} />
        <Field label="Priority (lower is tried first)">
          <input
            className={inputClass}
            inputMode="numeric"
            placeholder="100"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </Field>
        <InlineError message={errors.priority ?? null} />
      </form>
    </Modal>
  );
}
