// src/components/dashboard/ProviderCard.tsx
import { listConnections } from "@/lib/db/connections.ts";
import type { Provider } from "@/lib/db/types.ts";
import { ConnectionRow } from "./ConnectionRow.tsx";
import { AddConnectionForm } from "./AddConnectionForm.tsx";

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
        <span className={provider.enabled ? "text-xs text-success" : "text-xs text-text-muted"}>
          {provider.enabled ? "enabled" : "disabled"}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {connections.map((c) => (
          <ConnectionRow key={c.id} connection={c} />
        ))}
      </div>
      <AddConnectionForm providerId={provider.id} />
    </div>
  );
}
