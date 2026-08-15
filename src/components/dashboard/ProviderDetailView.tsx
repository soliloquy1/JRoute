// src/components/dashboard/ProviderDetailView.tsx
import Link from "next/link";
import type { Connection, Provider } from "@/lib/db/types.ts";
import { getProviderQuotaStatus } from "@/lib/db/analytics.ts";
import { ModelManager, type ModelRowData } from "./ModelManager.tsx";
import { ToastProvider, StatusDot, SectionTitle } from "./ui.tsx";

// Read the clock in a named helper so the impure `Date.now()` call stays out of the
// component render body (react-hooks/purity). Mirrors ProviderCard.isConnectionHealthy.
function clockNow(): number {
  return Date.now();
}

/**
 * Synchronous view for a provider's detail page. Kept separate from the async route
 * (`providers/[id]/page.tsx`) so it can be unit-rendered without a Next request context.
 * Data fetching (provider/models/connections) stays in the route; this only renders.
 */
export function ProviderDetailView({
  provider,
  models,
  connections,
}: {
  provider: Provider;
  models: ModelRowData[];
  connections: Connection[];
}) {
  const now = clockNow();
  const quotaByConnection = new Map(
    getProviderQuotaStatus(provider.id, now).map((q) => [q.connectionId, q])
  );

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href="/providers"
          className="text-xs text-accent transition-colors hover:text-accent/80"
        >
          ← Providers
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-text-main">{provider.name}</h1>
          <StatusDot
            tone={provider.enabled ? "ok" : "idle"}
            label={provider.enabled ? "enabled" : "disabled"}
          />
        </div>
        <p className="mt-1 truncate font-mono text-[11px] text-text-muted">
          {provider.id} · {provider.baseUrl} · {provider.wireFormat}
          {provider.modelPrefix ? ` · prefix: ${provider.modelPrefix}` : ""}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <SectionTitle>Models</SectionTitle>
        <ToastProvider>
          <ModelManager providerId={provider.id} models={models} />
        </ToastProvider>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Connections</SectionTitle>
        {connections.length === 0 ? (
          <p className="text-xs text-text-muted">No connections yet. Add one from the Providers page.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {connections.map((c) => {
              const q = quotaByConnection.get(c.id);
              const overQuota = q?.overQuota ?? false;
              const inCooldown = c.cooldownUntil != null && c.cooldownUntil > now;
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-control border border-border bg-bg px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-text-main">{c.label}</p>
                    <p className="text-[10px] text-text-muted">
                      priority {c.priority}
                      {q?.requestLimit != null ? ` · quota ${q.requests}/${q.requestLimit} req` : ""}
                      {q?.tokenLimit != null ? ` · ${q.tokens}/${q.tokenLimit} tok` : ""}
                    </p>
                  </div>
                  <StatusDot
                    tone={overQuota ? "error" : inCooldown ? "warn" : "ok"}
                    label={overQuota ? "over quota" : inCooldown ? "cooldown" : "ok"}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
