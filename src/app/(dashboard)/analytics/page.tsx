// src/app/(dashboard)/analytics/page.tsx
import { getProviderUsageTotals, getProviderQuotaStatus } from "@/lib/db/analytics.ts";
import { getDailyRequestCounts, getUsageSummary } from "@/lib/db/usageLogs.ts";
import { listProviders } from "@/lib/db/providers.ts";
import { StatCard } from "@/components/dashboard/StatCard.tsx";
import { BarChart } from "@/components/dashboard/BarChart.tsx";
import { ProviderUsageTable } from "@/components/dashboard/ProviderUsageTable.tsx";
import { QuotaStatusTable, type QuotaStatusRow } from "@/components/dashboard/QuotaStatusTable.tsx";
import { SectionTitle } from "@/components/dashboard/ui.tsx";

const DAY_MS = 24 * 3600 * 1000;
const WINDOW_MS = 30 * DAY_MS;

// Usage/quota tabs only (plan Phase 3) — cost is explicitly dropped: usage_logs.cost_us
// has no writer (no per-model pricing table, models.dev sync is out of scope), so a
// "Cost" tab would just show a permanent 0. combo/compression/search/evals tabs are
// out of scope (those subsystems aren't ported).
function getAnalyticsData() {
  const since = Date.now() - WINDOW_MS;
  const summary = getUsageSummary(since);
  const daily = getDailyRequestCounts(since);
  const providerUsage = getProviderUsageTotals(since);

  const now = Date.now();
  const quotaRows: QuotaStatusRow[] = listProviders().flatMap((provider) =>
    getProviderQuotaStatus(provider.id, now)
      .filter((c) => c.requestLimit !== null || c.tokenLimit !== null)
      .map((c) => ({
        providerId: provider.id,
        connectionId: c.connectionId,
        label: c.label,
        requests: c.requests,
        requestLimit: c.requestLimit,
        tokens: c.tokens,
        tokenLimit: c.tokenLimit,
        overQuota: c.overQuota,
      }))
  );

  return { summary, daily, providerUsage, quotaRows };
}

export default function AnalyticsPage() {
  const { summary, daily, providerUsage, quotaRows } = getAnalyticsData();
  const errorRate =
    summary.requestCount > 0 ? Math.round((summary.errorCount / summary.requestCount) * 100) : 0;

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <h1 className="text-lg font-semibold text-text-main">Analytics</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Requests (30d)" value={summary.requestCount.toLocaleString()} sub="Across all providers" />
        <StatCard label="Error rate (30d)" value={`${errorRate}%`} sub={`${summary.errorCount} of ${summary.requestCount}`} />
        <StatCard
          label="Tokens (30d)"
          value={(summary.totalPromptTokens + summary.totalOutputTokens).toLocaleString()}
          sub="Prompt + output"
        />
        <StatCard label="Avg latency (30d)" value={`${Math.round(summary.avgLatencyMs)}ms`} sub="Across all providers" />
      </div>

      <BarChart data={daily} />

      <div className="flex flex-col gap-2">
        <SectionTitle>Usage by provider</SectionTitle>
        <ProviderUsageTable rows={providerUsage} />
      </div>

      <div className="flex flex-col gap-2">
        <SectionTitle>Quota status</SectionTitle>
        <QuotaStatusTable rows={quotaRows} />
      </div>
    </div>
  );
}
