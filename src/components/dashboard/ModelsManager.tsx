// src/components/dashboard/ModelsManager.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Model } from "@/lib/db/models.ts";
import type { Provider } from "@/lib/db/types.ts";
import {
  PrimaryButton,
  GhostButton,
  DangerButton,
  Field,
  inputClass,
  InlineError,
} from "./ui.tsx";

interface ModelsManagerProps {
  initialModels: Model[];
  providers: Provider[];
}

export function ModelsManager({ initialModels, providers }: ModelsManagerProps) {
  const router = useRouter();
  const [models, setModels] = useState<Model[]>(initialModels);
  const [filter, setFilter] = useState<string>("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [maxTokens, setMaxTokens] = useState("8192");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const visible = filter ? models.filter((m) => m.providerId === filter) : models;

  async function refresh() {
    router.refresh();
  }

  async function addModel(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId,
        modelId,
        maxTokens: Number(maxTokens) || 8192,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "Failed to add model");
      return;
    }
    setModelId("");
    await refresh();
  }

  async function removeModel(m: Model) {
    if (!confirm(`Delete ${m.clientId}?`)) return;
    const res = await fetch(
      `/api/models/${encodeURIComponent(m.providerId)}/${encodeURIComponent(m.modelId)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      await refresh();
    } else {
      const b = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(b?.error?.message ?? "Failed to delete model");
    }
  }

  async function toggleEnabled(m: Model) {
    const res = await fetch(
      `/api/models/${encodeURIComponent(m.providerId)}/${encodeURIComponent(m.modelId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !m.enabled }),
      }
    );
    if (res.ok) {
      await refresh();
    } else {
      const b = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(b?.error?.message ?? "Failed to update model");
    }
  }

  async function importFrom(provider: Provider) {
    setImporting(provider.id);
    setImportMsg(null);
    const res = await fetch(`/api/providers/${encodeURIComponent(provider.id)}/import-models`, {
      method: "POST",
    });
    setImporting(null);
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      imported?: number;
      total?: number;
    } | null;
    if (!res.ok) {
      setImportMsg(body?.error?.message ?? "Import failed");
      return;
    }
    setImportMsg(`Imported ${body?.imported ?? 0} of ${body?.total ?? 0} models`);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <InlineError message={error} />
      <InlineError message={importMsg} />

      <div className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-card p-4 shadow-soft">
        <Field label="Provider" className="min-w-[160px]">
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select provider…</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id}
                {p.modelPrefix ? ` · prefix ${p.modelPrefix}` : ""})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Model id (native, no /)" className="min-w-[200px] flex-1">
          <input
            placeholder="gpt-5.6-sol"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className={`${inputClass} font-mono text-[13px]`}
          />
        </Field>
        <Field label="Max output tokens" className="w-[140px]">
          <input
            type="number"
            min={1}
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            className={inputClass}
          />
        </Field>
        <PrimaryButton onClick={addModel} disabled={busy || !providerId || !modelId}>
          {busy ? "Adding…" : "Add model"}
        </PrimaryButton>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Filter by provider</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className={`${inputClass} w-auto`}
          >
            <option value="">All ({models.length})</option>
            {providers.map((p) => {
              const count = models.filter((m) => m.providerId === p.id).length;
              return (
                <option key={p.id} value={p.id}>
                  {p.name} ({count})
                </option>
              );
            })}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {providers.map((p) => (
            <GhostButton
              key={p.id}
              onClick={() => importFrom(p)}
              disabled={importing === p.id}
            >
              {importing === p.id ? "Importing…" : `Import from ${p.name}`}
            </GhostButton>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-text-muted">No models yet. Add one above or import from a provider.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs text-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Model (request as)</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Max tokens</th>
                <th className="px-3 py-2 font-medium">Enabled</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={`${m.providerId}/${m.modelId}`} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-[13px] text-text-main">{m.clientId}</td>
                  <td className="px-3 py-2 text-text-muted">{m.providerId}</td>
                  <td className="px-3 py-2 text-text-muted">{m.maxTokens}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleEnabled(m)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        m.enabled ? "bg-success/10 text-success" : "bg-bg-subtle text-text-muted"
                      }`}
                    >
                      {m.enabled ? "on" : "off"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <DangerButton onClick={() => removeModel(m)}>Delete</DangerButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
