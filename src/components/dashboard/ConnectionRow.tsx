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

  async function remove() {
    if (!window.confirm("Remove this connection?")) return;
    const res = await fetch(`/api/connections/${connection.id}`, { method: "DELETE" });
    if (!res.ok) {
      console.error("Failed to remove connection", connection.id);
      return;
    }
    router.refresh();
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch(`/api/connections/${connection.id}/test`, { method: "POST" });
    const body = (await res.json()) as { ok: boolean; error: string | null };
    setTesting(false);
    setTestResult(body.ok ? "OK" : (body.error ?? "Failed"));
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between rounded-control border border-border bg-bg-subtle px-3 py-2">
      <div className="flex items-center gap-2 text-sm text-text-main">
        <span className={healthy ? "text-success" : "text-error"}>●</span>
        {connection.label}
        {connection.credentialDecryptFailed && (
          <span className="text-xs text-error">(key undecryptable)</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {testResult && <span className="text-xs text-text-muted">{testResult}</span>}
        <button
          onClick={runTest}
          disabled={testing}
          className="text-xs text-accent hover:underline disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test"}
        </button>
        <button onClick={remove} className="text-xs text-error hover:underline">
          Remove
        </button>
      </div>
    </div>
  );
}
