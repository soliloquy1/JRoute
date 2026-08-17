// src/components/dashboard/ConnectionRow.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Connection } from "@/lib/db/types.ts";
import type { ConnectionQuotaInfo } from "./ConnectionList.tsx";
import { extractApiErrorMessage } from "./apiErrorMessage.ts";

export function ConnectionRow({
  connection,
  healthy,
  quota,
}: {
  connection: Connection;
  healthy: boolean;
  quota?: ConnectionQuotaInfo;
}) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [toggling, setToggling] = useState(false);
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
    const body = await res.json().catch(() => null);
    setTesting(false);
    // A successful test call (200) sends {ok,error} from testConnection() — `error` is a
    // bare string there. An unauthenticated/invalid-id/crashed request (401/400/500)
    // instead goes through jsonError(), whose `error` is an OBJECT ({message,type,code}) —
    // extractApiErrorMessage() handles both shapes so a non-200 response can't hand a raw
    // object to setTestResult (React error #31, same class as ModelManager's import bug).
    setTestResult(res.ok && (body as { ok?: boolean } | null)?.ok ? "OK" : extractApiErrorMessage(body, "Failed"));
    router.refresh();
  }

  async function toggleEnabled() {
    if (toggling) return;
    setToggling(true);
    setError(null);
    const res = await fetch(`/api/connections/${connection.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !connection.enabled }),
    });
    setToggling(false);
    if (!res.ok) {
      setError("Failed to update connection");
      return;
    }
    router.refresh();
  }

  const statusLabel = !connection.enabled ? "disabled" : healthy ? "connected" : "cooling down";
  const statusColor = !connection.enabled
    ? "bg-text-muted"
    : healthy
      ? "bg-success"
      : "bg-error";

  return (
    <div className="rounded-control border border-border bg-bg px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm text-text-main">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} title={statusLabel} />
          <span className="truncate">{connection.label}</span>
          <span className="shrink-0 font-mono text-[10px] text-text-muted">#{connection.priority}</span>
          {connection.credentialDecryptFailed && (
            <span className="shrink-0 rounded-full bg-error/10 px-1.5 py-0.5 text-[10px] text-error">
              key undecryptable
            </span>
          )}
          {quota && (quota.requestLimit !== null || quota.tokenLimit !== null) && (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
                quota.overQuota ? "bg-error/10 text-error" : "bg-bg-subtle text-text-muted"
              }`}
            >
              {quota.requestLimit !== null ? `${quota.requests}/${quota.requestLimit} req` : ""}
              {quota.requestLimit !== null && quota.tokenLimit !== null ? " · " : ""}
              {quota.tokenLimit !== null ? `${quota.tokens}/${quota.tokenLimit} tok` : ""}
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
            onClick={toggleEnabled}
            disabled={toggling}
            role="switch"
            aria-checked={connection.enabled}
            title={connection.enabled ? "Disable connection" : "Enable connection"}
            className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              connection.enabled ? "bg-primary" : "bg-bg-subtle"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                connection.enabled ? "translate-x-3" : "translate-x-0"
              }`}
            />
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
