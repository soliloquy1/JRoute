// src/components/dashboard/BarChart.tsx
import type { DailyCount } from "@/lib/db/usageLogs.ts";

export function BarChart({ data }: { data: DailyCount[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);
  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-xs text-text-muted">Requests per day</span>
        <span className="font-mono text-[11px] text-text-muted tabular-nums">
          {total.toLocaleString()} total · 30d
        </span>
      </div>
      <div className="flex h-36 items-end gap-[3px]">
        {data.map((d) => (
          <div
            key={d.day}
            className={`flex-1 rounded-sm transition-colors ${
              d.count > 0 ? "bg-primary/70 hover:bg-primary" : "bg-bg-subtle"
            }`}
            style={{ height: d.count > 0 ? `max(${(d.count / max) * 100}%, 3px)` : "2px" }}
            title={`${d.day}: ${d.count}`}
          />
        ))}
      </div>
    </div>
  );
}
