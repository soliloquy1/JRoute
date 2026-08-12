import { getUsageSummary, getDailyRequestCounts } from "@/lib/db/usageLogs.ts";
import { listApiKeys } from "@/lib/auth/apiKeys.ts";
import { StatCard } from "@/components/dashboard/StatCard.tsx";
import { BarChart } from "@/components/dashboard/BarChart.tsx";

const DAY_MS = 24 * 3600 * 1000;

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getOverviewData() {
  const todaySummary = getUsageSummary(startOfTodayMs());
  const last24h = getUsageSummary(Date.now() - DAY_MS);
  const activeKeys = listApiKeys().length;
  const errorRate =
    last24h.requestCount > 0 ? Math.round((last24h.errorCount / last24h.requestCount) * 100) : 0;
  const daily = getDailyRequestCounts(Date.now() - 30 * DAY_MS);
  return { todaySummary, last24h, activeKeys, errorRate, daily };
}

export default function OverviewPage() {
  const { todaySummary, last24h, activeKeys, errorRate, daily } = getOverviewData();

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Requests today"
          value={String(todaySummary.requestCount)}
          sub="Since midnight"
        />
        <StatCard label="Active keys" value={String(activeKeys)} sub="Issued and not revoked" />
        <StatCard
          label="Error rate (24h)"
          value={`${errorRate}%`}
          sub={`${last24h.errorCount} of ${last24h.requestCount} requests`}
        />
        <StatCard
          label="Avg latency (24h)"
          value={`${Math.round(last24h.avgLatencyMs)}ms`}
          sub="Across all providers"
        />
      </div>
      <BarChart data={daily} />
    </div>
  );
}
