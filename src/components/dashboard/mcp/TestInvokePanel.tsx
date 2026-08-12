// src/components/dashboard/mcp/TestInvokePanel.tsx
"use client";

import { useState } from "react";

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
      const body = (await res.json()) as { error: { message: string } };
      setError(body.error.message);
      return;
    }
    const body = (await res.json()) as { result: unknown };
    setResult(JSON.stringify(body.result, null, 2));
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-control border border-border bg-bg-subtle p-2">
      <div className="text-xs font-medium text-text-main">{tool.function.name}</div>
      <p className="text-xs text-text-muted">{tool.function.description}</p>
      <textarea
        value={argsText}
        onChange={(e) => setArgsText(e.target.value)}
        rows={3}
        className="rounded-control border border-border bg-bg p-2 font-mono text-xs text-text-main"
      />
      <button
        onClick={invoke}
        disabled={loading}
        className="self-start rounded-control bg-primary px-2 py-1 text-xs text-white hover:bg-primary-hover disabled:opacity-50"
      >
        {loading ? "Invoking…" : "Invoke"}
      </button>
      {error && <p className="text-xs text-error">{error}</p>}
      {result && (
        <pre className="max-h-40 overflow-auto rounded-control bg-bg p-2 text-xs text-text-main">
          {result}
        </pre>
      )}
    </div>
  );
}
