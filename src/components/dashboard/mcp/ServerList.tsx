// src/components/dashboard/mcp/ServerList.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { McpServer } from "@/lib/db/types.ts";
import { TestInvokePanel } from "./TestInvokePanel.tsx";

interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export function ServerList({ servers }: { servers: McpServer[] }) {
  const router = useRouter();
  const [tools, setTools] = useState<Record<number, ToolDef[] | null>>({});
  const [discovering, setDiscovering] = useState<number | null>(null);
  const [discoverError, setDiscoverError] = useState<Record<number, string>>({});
  const [selectedTool, setSelectedTool] = useState<{ serverId: number; tool: ToolDef } | null>(
    null
  );

  async function discover(serverId: number) {
    setDiscovering(serverId);
    setDiscoverError((e) => ({ ...e, [serverId]: "" }));
    const res = await fetch(`/api/mcp-servers/${serverId}/discover`, { method: "POST" });
    setDiscovering(null);
    if (!res.ok) {
      const body = (await res.json()) as { error: { message: string } };
      setDiscoverError((e) => ({ ...e, [serverId]: body.error.message }));
      return;
    }
    const body = (await res.json()) as { tools: ToolDef[] };
    setTools((t) => ({ ...t, [serverId]: body.tools }));
  }

  async function confirm(serverId: number) {
    await fetch(`/api/mcp-servers/${serverId}/confirm`, { method: "POST" });
    router.refresh();
  }

  async function remove(serverId: number) {
    await fetch(`/api/mcp-servers/${serverId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {servers.map((s) => (
        <div key={s.id} className="rounded-card border border-border bg-card p-4 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-text-main">{s.name}</div>
              <div className="text-xs text-text-muted">
                {s.transport} · {s.target}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={s.enabled ? "text-success" : "text-text-muted"}>
                {s.enabled ? "enabled" : "disabled"}
              </span>
              {s.transport === "stdio" && (
                <span className={s.confirmedAt ? "text-success" : "text-error"}>
                  {s.confirmedAt ? "confirmed" : "unconfirmed"}
                </span>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {s.transport === "stdio" && !s.confirmedAt && (
              <button
                onClick={() => confirm(s.id)}
                className="rounded-control bg-error px-2 py-1 text-xs text-white hover:opacity-90"
                title="This will allow JRoute to spawn a local process for this server."
              >
                Confirm spawn
              </button>
            )}
            <button
              onClick={() => discover(s.id)}
              disabled={discovering === s.id}
              className="rounded-control px-2 py-1 text-xs text-accent hover:bg-bg-subtle disabled:opacity-50"
            >
              {discovering === s.id ? "Discovering…" : "Discover tools"}
            </button>
            <button
              onClick={() => remove(s.id)}
              className="rounded-control px-2 py-1 text-xs text-error hover:bg-bg-subtle"
            >
              Delete
            </button>
          </div>
          {discoverError[s.id] && <p className="mt-2 text-xs text-error">{discoverError[s.id]}</p>}
          {tools[s.id] && (
            <div className="mt-3 flex flex-col gap-1">
              {tools[s.id]!.map((t) => (
                <div key={t.function.name}>
                  <button
                    onClick={() => setSelectedTool({ serverId: s.id, tool: t })}
                    className="text-left text-xs text-text-main hover:underline"
                  >
                    {t.function.name}
                  </button>
                  {selectedTool?.serverId === s.id &&
                    selectedTool.tool.function.name === t.function.name && (
                      <TestInvokePanel serverId={s.id} tool={t} />
                    )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
