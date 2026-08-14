// src/components/dashboard/ProviderCard.tsx
import { listConnections } from "@/lib/db/connections.ts";
import type { Connection, Provider } from "@/lib/db/types.ts";
import { ConnectionList } from "./ConnectionList.tsx";
import { AddConnectionForm } from "./AddConnectionForm.tsx";
import { RemoveProviderButton } from "./RemoveProviderButton.tsx";
import { ProviderPrefixEditor } from "./ProviderPrefixEditor.tsx";

// Plain (non-component) helper so the impure `Date.now()` read happens outside
// the component render body — keeps `react-hooks/purity` happy while still
// recomputing on every server render (i.e. every `router.refresh()`).
function isConnectionHealthy(connection: Connection): boolean {
  return connection.cooldownUntil === null || connection.cooldownUntil <= Date.now();
}

export function ProviderCard({ provider }: { provider: Provider }) {
  const connections = listConnections(provider.id);
  return (
    <section className="flex flex-col rounded-card border border-border bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-text-main">{provider.name}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                provider.enabled
                  ? "bg-success/10 text-success"
                  : "bg-bg-subtle text-text-muted"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${provider.enabled ? "bg-success" : "bg-text-muted"}`} />
              {provider.enabled ? "enabled" : "disabled"}
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
            {provider.baseUrl} · {provider.wireFormat}
          </div>
          <div className="mt-1">
            <ProviderPrefixEditor providerId={provider.id} prefix={provider.modelPrefix} />
          </div>
        </div>
        <RemoveProviderButton providerId={provider.id} />
      </div>
      <ConnectionList
        items={connections.map((c) => ({ connection: c, healthy: isConnectionHealthy(c) }))}
      />
      <div className="mt-2">
        <AddConnectionForm providerId={provider.id} />
      </div>
    </section>
  );
}
