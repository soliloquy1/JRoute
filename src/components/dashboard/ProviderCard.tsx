// src/components/dashboard/ProviderCard.tsx
import { listConnections } from "@/lib/db/connections.ts";
import type { Connection, Provider } from "@/lib/db/types.ts";
import { ConnectionList } from "./ConnectionList.tsx";
import { AddConnectionForm } from "./AddConnectionForm.tsx";
import { RemoveProviderButton } from "./RemoveProviderButton.tsx";

// Plain (non-component) helper so the impure `Date.now()` read happens outside
// the component render body — matches the pattern in `(dashboard)/page.tsx`'s
// `getOverviewData()` and keeps `react-hooks/purity` happy while still recomputing
// on every server render (i.e. every `router.refresh()`), unlike a client-side
// `useState` lazy initializer which only runs once at mount.
function isConnectionHealthy(connection: Connection): boolean {
  return connection.cooldownUntil === null || connection.cooldownUntil <= Date.now();
}

export function ProviderCard({ provider }: { provider: Provider }) {
  const connections = listConnections(provider.id);
  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-medium text-text-main">{provider.name}</div>
          <div className="text-xs text-text-muted">
            {provider.baseUrl} · {provider.wireFormat}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={provider.enabled ? "text-xs text-success" : "text-xs text-text-muted"}>
            {provider.enabled ? "enabled" : "disabled"}
          </span>
          <RemoveProviderButton providerId={provider.id} />
        </div>
      </div>
      <ConnectionList
        items={connections.map((c) => ({ connection: c, healthy: isConnectionHealthy(c) }))}
      />
      <AddConnectionForm providerId={provider.id} />
    </div>
  );
}
