// src/app/(dashboard)/mcp/page.tsx
import { listMcpServers } from "@/lib/db/mcpServers.ts";
import { ServerList } from "@/components/dashboard/mcp/ServerList.tsx";
import { AddServerForm } from "@/components/dashboard/mcp/AddServerForm.tsx";

export default function McpPage() {
  const servers = listMcpServers();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-main">MCP servers</h1>
        <AddServerForm />
      </div>
      <ServerList servers={servers} />
    </div>
  );
}
