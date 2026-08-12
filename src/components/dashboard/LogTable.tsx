import type { UsageLogRow } from "@/lib/db/usageLogs.ts";
import type { ApiKeyRecord } from "@/lib/db/types.ts";

export function LogTable({ rows, keys }: { rows: UsageLogRow[]; keys: ApiKeyRecord[] }) {
  const labelFor = (id: number | null) => keys.find((k) => k.id === id)?.label ?? "(unknown)";
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-text-muted">
          <th className="py-2">Time</th>
          <th>Key</th>
          <th>Provider</th>
          <th>Model</th>
          <th>Tokens</th>
          <th>Latency</th>
          <th>Rounds</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border text-text-main">
            <td className="py-2">{new Date(r.createdAt).toLocaleString()}</td>
            <td>{r.apiKeyId ? labelFor(r.apiKeyId) : "-"}</td>
            <td>{r.providerId ?? "-"}</td>
            <td>{r.model ?? "-"}</td>
            <td>{(r.promptTokens ?? 0) + (r.outputTokens ?? 0)}</td>
            <td>{r.latencyMs}ms</td>
            <td>{r.toolRounds}</td>
            <td className="max-w-[200px] truncate text-error">{r.error ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
