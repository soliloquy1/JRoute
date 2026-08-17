// src/components/dashboard/QuotaStatusTable.tsx
import { EmptyState, StatusDot } from "./ui.tsx";

export interface QuotaStatusRow {
  providerId: string;
  connectionId: number;
  label: string;
  requests: number;
  requestLimit: number | null;
  tokens: number;
  tokenLimit: number | null;
  overQuota: boolean;
}

function limitText(used: number, limit: number | null): string {
  return limit === null ? used.toLocaleString() : `${used.toLocaleString()} / ${limit.toLocaleString()}`;
}

export function QuotaStatusTable({ rows }: { rows: QuotaStatusRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="speed"
        title="No connections with a quota window configured"
        body="Set requests/tokens thresholds on a connection to see live quota status here."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th className="px-4 py-2.5 font-medium">Provider</th>
            <th className="px-4 py-2.5 font-medium">Connection</th>
            <th className="px-4 py-2.5 text-right font-medium">Requests</th>
            <th className="px-4 py-2.5 text-right font-medium">Tokens</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.providerId}:${r.connectionId}`}
              className="border-b border-border/60 last:border-0 hover:bg-bg-subtle/50"
            >
              <td className="px-4 py-2 text-text-main">{r.providerId}</td>
              <td className="px-4 py-2 text-text-muted">{r.label}</td>
              <td className="px-4 py-2 text-right font-mono text-xs text-text-muted tabular-nums">
                {limitText(r.requests, r.requestLimit)}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs text-text-muted tabular-nums">
                {limitText(r.tokens, r.tokenLimit)}
              </td>
              <td className="px-4 py-2">
                <StatusDot tone={r.overQuota ? "error" : "ok"} label={r.overQuota ? "over quota" : "ok"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
