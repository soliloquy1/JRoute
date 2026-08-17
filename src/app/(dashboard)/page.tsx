import { getUsageSummary, getDailyRequestCounts } from "@/lib/db/usageLogs.ts";
import { listApiKeys } from "@/lib/auth/apiKeys.ts";
import { countProvidersWithConnections } from "@/lib/db/connections.ts";
import { listRichPresets } from "@/lib/db/richPresets.ts";
import { StatCard } from "@/components/dashboard/StatCard.tsx";
import { BarChart } from "@/components/dashboard/BarChart.tsx";
import { GettingStarted } from "@/components/dashboard/GettingStarted.tsx";

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
  // Catalog providers are auto-seeded at boot, so a raw provider-row count is nonzero
  // on a fresh install with zero credentials configured — count providers that
  // actually have a connection instead, so the checklist reflects real setup progress.
  const providerCount = countProvidersWithConnections();
  const presetCount = listRichPresets().length;
  const errorRate =
    last24h.requestCount > 0 ? Math.round((last24h.errorCount / last24h.requestCount) * 100) : 0;
  const daily = getDailyRequestCounts(Date.now() - 30 * DAY_MS);
  return { todaySummary, last24h, activeKeys, providerCount, presetCount, errorRate, daily };
}

export default function OverviewPage() {
  const { todaySummary, last24h, activeKeys, providerCount, presetCount, errorRate, daily } =
    getOverviewData();
  // Show the checklist until the basic chain exists: provider → key → preset. Individual
  // steps render completed states as the operator works through them.
  const setupIncomplete = providerCount === 0 || activeKeys === 0 || presetCount === 0;

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      {setupIncomplete && (
        <GettingStarted
          hasProviders={providerCount > 0}
          hasKeys={activeKeys > 0}
          hasPresets={presetCount > 0}
        />
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
