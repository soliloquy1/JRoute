// src/components/dashboard/ModelManager.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, GhostButton, InlineError, StatusDot, useToast } from "./ui.tsx";
import { extractApiErrorMessage } from "./apiErrorMessage.ts";

export interface ModelRowData {
  providerId: string;
  modelId: string;
  clientId: string;
  enabled: boolean;
}

/**
 * Model management for a provider's detail page: list the provider's models, toggle each
 * one's enabled flag, delete, and bulk-import the live model list. No SWR/next-intl/store —
 * actions POST then call router.refresh() to re-read server state.
 */
export function ModelManager({ providerId, models }: { providerId: string; models: ModelRowData[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(modelId: string, body: Record<string, unknown>) {
    setBusy(modelId);
    setError(null);
    const res = await fetch(
      `/api/models/${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setBusy(null);
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      const msg = extractApiErrorMessage(b, "Failed to update model");
      setError(msg);
      toast(msg, "error");
      return;
    }
    router.refresh();
  }

  async function remove(modelId: string) {
    if (!window.confirm(`Delete model ${modelId}?`)) return;
    setBusy(modelId);
    setError(null);
    const res = await fetch(
      `/api/models/${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`,
      { method: "DELETE" }
    );
    setBusy(null);
    if (!res.ok) {
      const msg = "Failed to delete model";
      setError(msg);
      toast(msg, "error");
      return;
    }
    router.refresh();
  }

  async function importModels() {
    setImporting(true);
    setError(null);
    const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/import-models`, {
      method: "POST",
    });
    setImporting(false);
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      const msg = extractApiErrorMessage(b, "Import failed");
      setError(msg);
      toast(msg, "error");
      return;
    }
    const b = (await res.json().catch(() => null)) as { imported?: number } | null;
    toast(`Imported ${b?.imported ?? 0} model(s)`, "ok");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">
          {models.filter((m) => m.enabled).length} of {models.length} enabled
        </span>
        <PrimaryButton onClick={importModels} disabled={importing}>
          {importing ? "Importing…" : "Import models"}
        </PrimaryButton>
      </div>
      <InlineError message={error} />
      {models.length === 0 ? (
        <p className="text-xs text-text-muted">
          No models yet. Use the Import models button to pull the provider live list (needs a
          connection with an API key), or a model was never seeded.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {models.map((m) => (
            <li
              key={m.clientId}
              className="flex items-center justify-between gap-3 rounded-control border border-border bg-bg px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[12px] text-text-main">{m.clientId}</p>
                <p className="truncate text-[10px] text-text-muted">{m.modelId}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusDot tone={m.enabled ? "ok" : "idle"} label={m.enabled ? "enabled" : "disabled"} />
                <GhostButton
                  onClick={() => patch(m.modelId, { enabled: !m.enabled })}
                  disabled={busy === m.modelId}
                >
                  {m.enabled ? "Disable" : "Enable"}
                </GhostButton>
                <GhostButton
                  onClick={() => remove(m.modelId)}
                  disabled={busy === m.modelId}
                  className="text-error hover:bg-error/10"
                >
                  Delete
                </GhostButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
