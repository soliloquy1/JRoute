// src/components/dashboard/ConnectionRow.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Connection } from "@/lib/db/types.ts";

export function ConnectionRow({
  connection,
  healthy,
}: {
  connection: Connection;
  healthy: boolean;
}) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Remove connection "${connection.label}"?`)) return;
    setError(null);
    const res = await fetch(`/api/connections/${connection.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to remove connection");
      return;
    }
    router.refresh();
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    const res = await fetch(`/api/connections/${connection.id}/test`, { method: "POST" });
    const body = (await res.json()) as { ok: boolean; error: string | null };
    setTesting(false);
    setTestResult(body.ok ? "OK" : (body.error ?? "Failed"));
    router.refresh();
  }

  return (
    <div className="rounded-control border border-border bg-bg px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm text-text-main">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${healthy ? "bg-success" : "bg-error"}`}
            title={healthy ? "Healthy" : "Cooling down"}
          />
          <span className="truncate">{connection.label}</span>
          {connection.credentialDecryptFailed && (
            <span className="shrink-0 rounded-full bg-error/10 px-1.5 py-0.5 text-[10px] text-error">
              key undecryptable
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {testResult && (
            <span
              className={`font-mono text-[11px] ${testResult === "OK" ? "text-success" : "text-error"}`}
            >
              {testResult}
            </span>
          )}
          <button
            onClick={runTest}
            disabled={testing}
            className="rounded-control px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-subtle hover:text-text-main disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test"}
          </button>
          <button
            onClick={remove}
            className="rounded-control px-2 py-1 text-xs text-text-muted transition-colors hover:bg-error/10 hover:text-error"
          >
            Remove
          </button>
        </div>
      </div>
      {error && <p className="mt-1 text-[11px] text-error">{error}</p>}
    </div>
  );
}
