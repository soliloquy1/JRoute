// src/components/dashboard/mcp/TestInvokePanel.tsx
"use client";

import { useState } from "react";
import { PrimaryButton } from "../ui.tsx";

interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export function TestInvokePanel({ serverId, tool }: { serverId: number; tool: ToolDef }) {
  const [argsText, setArgsText] = useState("{}");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function invoke() {
    setLoading(true);
    setError(null);
    setResult(null);
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsText);
    } catch {
      setLoading(false);
      setError("Args must be valid JSON");
      return;
    }
    const res = await fetch(`/api/mcp-servers/${serverId}/test-invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolName: tool.function.name, args }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "Invocation failed");
      return;
    }
    const body = (await res.json()) as { result: unknown };
    setResult(JSON.stringify(body.result, null, 2));
  }

  return (
    <div className="mt-1 mb-2 ml-5 flex flex-col gap-2 rounded-control border border-border bg-bg p-3">
      <p className="text-xs leading-relaxed text-text-muted">{tool.function.description}</p>
      <textarea
        value={argsText}
        onChange={(e) => setArgsText(e.target.value)}
        rows={3}
        spellCheck={false}
        className="rounded-control border border-border-strong bg-card p-2 font-mono text-xs text-text-main focus:border-primary"
      />
      <div>
        <PrimaryButton onClick={invoke} disabled={loading} className="px-2.5 py-1 text-xs">
          {loading ? "Invoking…" : "Invoke"}
        </PrimaryButton>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
      {result && (
        <pre className="max-h-48 overflow-auto rounded-control border border-border bg-card p-2 font-mono text-[11px] leading-relaxed text-text-main">
          {result}
        </pre>
      )}
    </div>
  );
}
