// src/components/dashboard/FallbackStrategyForm.tsx
"use client";

import { useState } from "react";
import { Field, Select, PrimaryButton, InlineError, ToastProvider, useToast } from "./ui.tsx";
import type { FallbackStrategy } from "@/lib/db/settings.ts";

function FallbackStrategyFormInner({ initialStrategy }: { initialStrategy: FallbackStrategy }) {
  const { toast } = useToast();
  const [strategy, setStrategy] = useState<FallbackStrategy>(initialStrategy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/fallback-strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategy }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
        const msg =
          typeof body?.error === "string" ? body.error : body?.error?.message ?? "Failed to save";
        setError(msg);
        toast(msg, "error");
        return;
      }
      toast("Saved", "ok");
    } catch {
      setError("Network error");
      toast("Network error — could not save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-3">
      <Field label="Connection fallback strategy">
        <Select value={strategy} onChange={(e) => setStrategy(e.target.value as FallbackStrategy)}>
          <option value="priority">Priority (always prefer lowest priority)</option>
          <option value="round-robin">Round-robin (rotate first pick per request)</option>
        </Select>
      </Field>
      <InlineError message={error} />
      <p className="text-xs text-text-muted">
        Applies to every provider with more than one enabled connection. Failover order within a
        single request is unaffected — this only changes which connection is tried first.
      </p>
      <PrimaryButton type="submit" disabled={saving} className="self-start">
        {saving ? "Saving…" : "Save"}
      </PrimaryButton>
    </form>
  );
}

export function FallbackStrategyForm({ initialStrategy }: { initialStrategy: FallbackStrategy }) {
  return (
    <ToastProvider>
      <FallbackStrategyFormInner initialStrategy={initialStrategy} />
    </ToastProvider>
  );
}
