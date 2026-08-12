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
    <div className="rounded-card border border-border bg-card p-4 shadow-soft">
      <div className="text-xs font-medium tracking-wide text-text-muted">
        {label.toUpperCase()}
      </div>
      <div className="mt-2 text-2xl font-semibold text-text-main">{value}</div>
      <div className="mt-1 text-xs text-text-muted">{sub}</div>
    </div>
  );
}
