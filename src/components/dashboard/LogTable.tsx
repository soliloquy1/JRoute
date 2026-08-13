// src/components/dashboard/LogTable.tsx
import type { UsageLogRow } from "@/lib/db/usageLogs.ts";
import type { ApiKeyRecord } from "@/lib/db/types.ts";
import { EmptyState } from "./ui.tsx";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function LogTable({ rows, keys }: { rows: UsageLogRow[]; keys: ApiKeyRecord[] }) {
  const labelFor = (id: number | null) => keys.find((k) => k.id === id)?.label ?? "(deleted key)";

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="receipt_long"
        title="No requests logged yet"
        body="Once a client sends chat completions through this proxy, each request lands here with its model, tokens, latency, and any error."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th className="px-4 py-2.5 font-medium">Time</th>
            <th className="px-4 py-2.5 font-medium">Key</th>
            <th className="px-4 py-2.5 font-medium">Provider</th>
            <th className="px-4 py-2.5 font-medium">Model</th>
            <th className="px-4 py-2.5 text-right font-medium">Tokens</th>
            <th className="px-4 py-2.5 text-right font-medium">Latency</th>
            <th className="px-4 py-2.5 font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-border/60 last:border-0 hover:bg-bg-subtle/50"
            >
              <td className="px-4 py-2 font-mono text-xs text-text-muted tabular-nums">
                {formatTime(r.createdAt)}
              </td>
              <td className="px-4 py-2 text-text-main">
                {r.apiKeyId ? labelFor(r.apiKeyId) : "-"}
              </td>
              <td className="px-4 py-2 text-text-muted">{r.providerId ?? "-"}</td>
              <td className="max-w-[180px] truncate px-4 py-2 font-mono text-xs text-text-main">
                {r.model ?? "-"}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs text-text-muted tabular-nums">
                {r.promptTokens === null && r.outputTokens === null
                  ? "—"
                  : (r.promptTokens ?? 0) + (r.outputTokens ?? 0)}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs text-text-muted tabular-nums">
                {r.latencyMs}ms
              </td>
              <td className="max-w-[220px] px-4 py-2">
                {r.error ? (
                  <span className="block truncate text-xs text-error" title={r.error}>
                    {r.error}
                  </span>
                ) : (
                  <span className="text-xs text-success">ok</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
