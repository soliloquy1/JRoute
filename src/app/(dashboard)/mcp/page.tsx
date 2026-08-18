// src/app/(dashboard)/mcp/page.tsx
import { listMcpServers } from "@/lib/db/mcpServers.ts";
import { listSearchProviders } from "@/lib/db/searchProviders.ts";
import { getActiveSearchProviderId } from "@/lib/db/settings.ts";
import { ServerList } from "@/components/dashboard/mcp/ServerList.tsx";
import { AddServerForm } from "@/components/dashboard/mcp/AddServerForm.tsx";
import { SearchProviderList } from "@/components/dashboard/mcp/SearchProviderList.tsx";
import { AddSearchProviderForm } from "@/components/dashboard/mcp/AddSearchProviderForm.tsx";

export default function McpPage() {
  const servers = listMcpServers();
  const providers = listSearchProviders();
  const activeId = getActiveSearchProviderId();
  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted">
            {servers.length === 0
              ? "No MCP servers configured"
              : `${servers.length} server${servers.length === 1 ? "" : "s"}`}
          </p>
          <AddServerForm />
        </div>
        <ServerList servers={servers} />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Web Search Providers</h2>
          <AddSearchProviderForm />
        </div>
        <p className="text-xs text-text-muted">
          Powers the built-in JRoute Web Search tool listed above — enable it and set a trigger
          pattern there once a provider is active here.
        </p>
        <SearchProviderList
          providers={providers.map((p) => ({ id: p.id, kind: p.kind, label: p.label }))}
          activeId={activeId}
        />
      </div>
    </div>
  );
}
