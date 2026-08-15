// src/components/dashboard/AddCompatibleProviderModal.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Modal,
  PrimaryButton,
  GhostButton,
  Field,
  Select,
  inputClass,
  InlineError,
  useToast,
} from "./ui.tsx";
import {
  validateAddCompatibleProvider,
  type AddCompatibleProviderValues,
} from "./providerFormValidation.ts";

/**
 * Modal to add a custom OpenAI/Anthropic/Gemini-compatible provider (and optionally an
 * API-key connection). Replaces the inline AddProviderForm. Client-side validation covers
 * the provider id regex, required name, a valid http(s) base URL, an optional prefix, and
 * duplicate-id detection against `existingIds`.
 */
export function AddCompatibleProviderModal({
  existingIds,
  onClose,
}: {
  existingIds: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<AddCompatibleProviderValues>({
    id: "",
    name: "",
    baseUrl: "",
    wireFormat: "openai",
    modelPrefix: "",
  });
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof AddCompatibleProviderValues, string>>>({});
  const [saving, setSaving] = useState(false);

  function set<K extends keyof AddCompatibleProviderValues>(key: K, value: AddCompatibleProviderValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fieldErrors = validateAddCompatibleProvider(values, existingIds);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSaving(true);
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: values.id.trim(),
        name: values.name.trim(),
        kind: "apikey",
        baseUrl: values.baseUrl.trim(),
        wireFormat: values.wireFormat,
        enabled: true,
        modelPrefix: values.modelPrefix.trim(),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string } | string;
      } | null;
      const msg =
        typeof body?.error === "string"
          ? body.error
          : body?.error?.message ?? "Failed to add provider";
      setSaving(false);
      toast(msg, "error");
      return;
    }

    // Optionally attach a connection so the provider is usable immediately.
    if (apiKey.trim()) {
      const cRes = await fetch("/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: values.id.trim(), label: "primary", apiKey: apiKey.trim() }),
      });
      if (!cRes.ok) {
        setSaving(false);
        toast("Provider added, but the connection failed", "error");
        onClose();
        router.refresh();
        return;
      }
    }

    setSaving(false);
    toast("Provider added", "ok");
    onClose();
    router.refresh();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add compatible provider"
      footer={
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" form="add-compatible-form" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </PrimaryButton>
        </div>
      }
    >
      <form id="add-compatible-form" onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label="Provider id">
          <input
            className={inputClass}
            placeholder="my-provider"
            value={values.id}
            onChange={(e) => set("id", e.target.value)}
          />
        </Field>
        <InlineError message={errors.id ?? null} />

        <Field label="Display name">
          <input
            className={inputClass}
            placeholder="My Provider"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <InlineError message={errors.name ?? null} />

        <Field label="Base URL">
          <input
            className={`${inputClass} font-mono text-[13px]`}
            placeholder="https://api.example.com/v1"
            value={values.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
          />
        </Field>
        <InlineError message={errors.baseUrl ?? null} />

        <Field label="Wire format">
          <Select
            value={values.wireFormat}
            onChange={(e) => set("wireFormat", e.target.value as AddCompatibleProviderValues["wireFormat"])}
          >
            <option value="openai">openai (Bearer)</option>
            <option value="anthropic">anthropic (x-api-key)</option>
            <option value="gemini">gemini (x-goog-api-key)</option>
          </Select>
        </Field>

        <Field label="Model prefix (optional)">
          <input
            className={`${inputClass} font-mono text-[13px]`}
            placeholder="myprov (requests become myprov/model)"
            value={values.modelPrefix}
            onChange={(e) => set("modelPrefix", e.target.value)}
          />
        </Field>
        <InlineError message={errors.modelPrefix ?? null} />

        <Field label="API key (optional — attach a connection now)">
          <input
            className={`${inputClass} font-mono text-[13px]`}
            type="password"
            placeholder="sk-…"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
