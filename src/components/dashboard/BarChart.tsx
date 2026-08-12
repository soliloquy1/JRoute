import type { DailyCount } from "@/lib/db/usageLogs.ts";

export function BarChart({ data }: { data: DailyCount[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft">
      <div className="mb-4 text-xs font-medium tracking-wide text-text-muted">
        REQUESTS PER DAY (LAST 30 DAYS)
      </div>
      <div className="flex h-40 items-end gap-1">
        {data.map((d) => (
          <div
            key={d.day}
            className="flex-1 rounded-t bg-accent/60"
            style={{ height: d.count > 0 ? `max(${(d.count / max) * 100}%, 2px)` : "0" }}
            title={`${d.day}: ${d.count}`}
          />
        ))}
      </div>
    </div>
  );
}
