// src/app/(dashboard)/mcp/page.tsx
import { listMcpServers } from "@/lib/db/mcpServers.ts";
import { ServerList } from "@/components/dashboard/mcp/ServerList.tsx";
import { AddServerForm } from "@/components/dashboard/mcp/AddServerForm.tsx";

export default function McpPage() {
  const servers = listMcpServers();
  return (
    <div className="flex max-w-5xl flex-col gap-4">
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
  );
}
