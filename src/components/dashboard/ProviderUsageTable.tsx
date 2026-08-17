// src/components/dashboard/ProviderUsageTable.tsx
import type { ProviderUsageRow } from "@/lib/db/analytics.ts";
import { EmptyState } from "./ui.tsx";

export function ProviderUsageTable({ rows }: { rows: ProviderUsageRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="bar_chart"
        title="No usage in this window"
        body="Requests through providers will show up here once traffic flows through the proxy."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th className="px-4 py-2.5 font-medium">Provider</th>
            <th className="px-4 py-2.5 text-right font-medium">Requests</th>
            <th className="px-4 py-2.5 text-right font-medium">Errors</th>
            <th className="px-4 py-2.5 text-right font-medium">Prompt tokens</th>
            <th className="px-4 py-2.5 text-right font-medium">Output tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.providerId}
              className="border-b border-border/60 last:border-0 hover:bg-bg-subtle/50"
            >
              <td className="px-4 py-2 text-text-main">{r.providerId}</td>
              <td className="px-4 py-2 text-right font-mono text-xs text-text-muted tabular-nums">
                {r.requests.toLocaleString()}
              </td>
              <td
                className={`px-4 py-2 text-right font-mono text-xs tabular-nums ${
                  r.errors > 0 ? "text-error" : "text-text-muted"
                }`}
              >
                {r.errors.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs text-text-muted tabular-nums">
                {r.promptTokens.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs text-text-muted tabular-nums">
                {r.outputTokens.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
