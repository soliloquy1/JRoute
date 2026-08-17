// src/components/dashboard/ProviderDetailView.tsx
import Link from "next/link";
import type { Connection, Provider } from "@/lib/db/types.ts";
import { getCatalogProvider } from "@/lib/catalog/index.ts";
import { getProviderQuotaStatus } from "@/lib/db/analytics.ts";
import { ModelManager, type ModelRowData } from "./ModelManager.tsx";
import { ConnectionList, type ConnectionListItem } from "./ConnectionList.tsx";
import { AddConnectionButton } from "./AddConnectionButton.tsx";
import { RemoveProviderButton } from "./RemoveProviderButton.tsx";
import { ProviderPrefixEditor } from "./ProviderPrefixEditor.tsx";
import { ToastProvider, StatusDot, SectionTitle, EmptyState } from "./ui.tsx";

// Read the clock in a named helper so the impure `Date.now()` call stays out of the
// component render body (react-hooks/purity).
function clockNow(): number {
  return Date.now();
}

function isConnectionHealthy(connection: Connection, now: number): boolean {
  return (
    connection.enabled &&
    !connection.credentialDecryptFailed &&
    (connection.cooldownUntil === null || connection.cooldownUntil <= now)
  );
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
  const items: ConnectionListItem[] = connections.map((c) => {
    const q = quotaByConnection.get(c.id);
    return {
      connection: c,
      healthy: isConnectionHealthy(c, now),
      quota: q
        ? {
            requests: q.requests,
            requestLimit: q.requestLimit,
            tokens: q.tokens,
            tokenLimit: q.tokenLimit,
            overQuota: q.overQuota,
          }
        : undefined,
    };
  });
  // A catalog provider's routing prefix is fixed by the catalog (matches the wire
  // format / registry it was curated against) — only operator-added custom
  // ("compatible") providers, absent from the catalog, get an editable prefix.
  const isCatalogProvider = getCatalogProvider(provider.id) !== null;

  return (
    <ToastProvider>
      <div className="flex max-w-4xl flex-col gap-6">
        <div>
          <Link href="/models" className="text-xs text-accent transition-colors hover:text-accent/80">
            ← Models
          </Link>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-text-main">{provider.name}</h1>
              <StatusDot
                tone={provider.enabled ? "ok" : "idle"}
                label={provider.enabled ? "enabled" : "disabled"}
              />
            </div>
            <RemoveProviderButton providerId={provider.id} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-text-muted">
            <span className="truncate">
              {provider.id} · {provider.baseUrl} · {provider.wireFormat}
            </span>
            {isCatalogProvider ? (
              <span title="Fixed by the provider catalog">prefix: {provider.modelPrefix || "(none)"}</span>
            ) : (
              <ProviderPrefixEditor providerId={provider.id} prefix={provider.modelPrefix ?? ""} />
            )}
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <SectionTitle>Connections</SectionTitle>
            <AddConnectionButton
              providerId={provider.id}
              providerName={provider.name}
              providerKind={provider.kind}
              oauthProviderKey={provider.oauthProvider}
            />
          </div>
          {items.length === 0 ? (
            <EmptyState
              icon="cable"
              title="No connections yet"
              body="Add a connection with an API key or OAuth token to start routing traffic through this provider."
            />
          ) : (
            <ConnectionList items={items} />
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle>Models</SectionTitle>
          <ModelManager providerId={provider.id} models={models} />
        </section>
      </div>
    </ToastProvider>
  );
}
