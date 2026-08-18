// src/components/dashboard/mcp/SearchProviderList.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { InlineError } from "../ui.tsx";

interface ProviderRow {
  id: number;
  kind: string;
  label: string;
  apiKeyMasked: string;
}

/**
 * Receives only id/kind/label (+ activeId) from the server component — never the
 * plaintext api key. Masked keys and the live active id are fetched client-side from
 * the API so the plaintext key never crosses the server→client boundary in this tree.
 */
export function SearchProviderList({
  providers,
  activeId,
}: {
  providers: { id: number; kind: string; label: string }[];
  activeId: number | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ProviderRow[]>(
    providers.map((p) => ({ ...p, apiKeyMasked: "••••" }))
  );
  const [active, setActive] = useState<number | null>(activeId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const [listRes, activeRes] = await Promise.all([
        fetch("/api/search-providers"),
        fetch("/api/search-providers/active"),
      ]);
      if (listRes.ok) {
        const body = (await listRes.json()) as { providers: ProviderRow[] };
        setRows(body.providers);
      }
      if (activeRes.ok) {
        const body = (await activeRes.json()) as { id: number | null };
        setActive(body.id);
      }
    } catch {
      setError("Failed to load search providers");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function setActiveProvider(id: number) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/search-providers/active", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setError("Failed to set active provider");
        return;
      }
      await reload();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: number, name: string) {
    if (!window.confirm(`Delete search provider "${name}"?`)) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/search-providers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to delete provider");
        return;
      }
      await reload();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return <p className="text-xs text-text-muted">No search providers configured yet.</p>;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {rows.map((p) => (
        <section
          key={p.id}
          className={`rounded-card border bg-card p-4 shadow-soft ${
            active === p.id ? "border-primary" : "border-border"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-text-main">{p.label}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                  {p.kind}
                </span>
                {active === p.id && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                    active
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
                {p.apiKeyMasked}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {active !== p.id && (
              <button
                onClick={() => setActiveProvider(p.id)}
                disabled={busy === p.id}
                className="rounded-control border border-border px-2.5 py-1 text-xs text-text-main transition-colors hover:bg-bg-subtle disabled:opacity-50"
              >
                Set active
              </button>
            )}
            <button
              onClick={() => remove(p.id, p.label)}
              disabled={busy === p.id}
              className="rounded-control px-2 py-1 text-xs text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </section>
      ))}
      <InlineError message={error} />
    </div>
  );
}
