// src/components/dashboard/StatCard.tsx
export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-card border border-border bg-card px-4 py-3.5 shadow-soft">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1.5 font-mono text-[26px] leading-none font-medium tracking-tight text-text-main tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-text-muted">{sub}</div>
    </div>
  );
}
