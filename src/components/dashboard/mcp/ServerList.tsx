// src/components/dashboard/mcp/ServerList.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { McpServer } from "@/lib/db/types.ts";
import { TestInvokePanel } from "./TestInvokePanel.tsx";
import { EmptyState, InlineError } from "../ui.tsx";
import { cn } from "@/lib/cn.ts";

interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export function ServerList({ servers }: { servers: McpServer[] }) {
  const router = useRouter();
  const [tools, setTools] = useState<Record<number, ToolDef[] | null>>({});
  const [discovering, setDiscovering] = useState<number | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [actionError, setActionError] = useState<Record<number, string>>({});
  const [selectedTool, setSelectedTool] = useState<{ serverId: number; tool: ToolDef } | null>(
    null
  );

  function setError(serverId: number, message: string) {
    setActionError((e) => ({ ...e, [serverId]: message }));
  }

  async function discover(serverId: number) {
    setDiscovering(serverId);
    setError(serverId, "");
    const res = await fetch(`/api/mcp-servers/${serverId}/discover`, { method: "POST" });
    setDiscovering(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(serverId, body?.error?.message ?? "Discovery failed");
      return;
    }
    const body = (await res.json()) as { tools: ToolDef[] };
    setTools((t) => ({ ...t, [serverId]: body.tools }));
  }

  async function toggleEnabled(serverId: number, currentlyEnabled: boolean) {
    if (toggling !== null) return;
    setToggling(serverId);
    setError(serverId, "");
    const res = await fetch(`/api/mcp-servers/${serverId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !currentlyEnabled }),
    });
    setToggling(null);
    if (!res.ok) {
      setError(serverId, "Failed to update server");
      return;
    }
    router.refresh();
  }

  async function confirm(serverId: number) {
    setError(serverId, "");
    const res = await fetch(`/api/mcp-servers/${serverId}/confirm`, { method: "POST" });
    if (!res.ok) {
      setError(serverId, "Failed to confirm server");
      return;
    }
    router.refresh();
  }

  async function remove(serverId: number, name: string) {
    if (!window.confirm(`Delete MCP server "${name}"?`)) return;
    setError(serverId, "");
    const res = await fetch(`/api/mcp-servers/${serverId}`, { method: "DELETE" });
    if (!res.ok) {
      setError(serverId, "Failed to delete server");
      return;
    }
    router.refresh();
  }

  if (servers.length === 0) {
    return (
      <EmptyState
        icon="dns"
        title="No MCP servers yet"
        body="MCP servers expose tools (search, memory, etc.) that trigger-mode presets can invoke mid-chat. Add one to get started."
      />
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {servers.map((s) => (
        <section key={s.id} className="rounded-card border border-border bg-card p-4 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-text-main">{s.name}</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    s.enabled ? "bg-success/10 text-success" : "bg-bg-subtle text-text-muted"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-success" : "bg-text-muted"}`}
                  />
                  {s.enabled ? "enabled" : "disabled"}
                </span>
                {s.transport === "stdio" && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      s.confirmedAt ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                    }`}
                  >
                    {s.confirmedAt ? "spawn confirmed" : "spawn unconfirmed"}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
                {s.transport} · {s.target}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {s.transport === "stdio" && !s.confirmedAt && (
              <button
                onClick={() => confirm(s.id)}
                className="rounded-control bg-warning px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                title="This will allow JRoute to spawn a local process for this server."
              >
                Confirm spawn
              </button>
            )}
            <button
              onClick={() => toggleEnabled(s.id, s.enabled)}
              disabled={toggling === s.id}
              role="switch"
              aria-checked={s.enabled}
              title={s.enabled ? "Disable server" : "Enable server"}
              className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                s.enabled ? "bg-primary" : "bg-bg-subtle"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                  s.enabled ? "translate-x-3" : "translate-x-0"
                }`}
              />
            </button>
            <button
              onClick={() => discover(s.id)}
              disabled={discovering === s.id}
              className="rounded-control border border-border px-2.5 py-1 text-xs text-text-main transition-colors hover:bg-bg-subtle disabled:opacity-50"
            >
              {discovering === s.id ? "Discovering…" : "Discover tools"}
            </button>
            <button
              onClick={() => remove(s.id, s.name)}
              className="rounded-control px-2 py-1 text-xs text-text-muted transition-colors hover:bg-error/10 hover:text-error"
            >
              Delete
            </button>
          </div>
          <InlineError message={actionError[s.id] || null} />
          {tools[s.id] && (
            <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
              <span className="text-[11px] font-semibold tracking-widest text-text-muted uppercase">
                Tools ({tools[s.id]!.length})
              </span>
              {tools[s.id]!.length === 0 && (
                <p className="text-xs text-text-muted">This server reported no tools.</p>
              )}
              {tools[s.id]!.map((t) => {
                const selected =
                  selectedTool?.serverId === s.id &&
                  selectedTool.tool.function.name === t.function.name;
                return (
                  <div key={t.function.name}>
                    <button
                      onClick={() => setSelectedTool(selected ? null : { serverId: s.id, tool: t })}
                      className={cn(
                        "flex items-center gap-1.5 rounded-control px-1.5 py-1 text-left font-mono text-xs transition-colors hover:bg-bg-subtle",
                        selected ? "text-primary" : "text-text-main"
                      )}
                    >
                      <span className="material-symbols-outlined !text-[14px] text-text-muted">
                        {selected ? "expand_less" : "chevron_right"}
                      </span>
                      {t.function.name}
                    </button>
                    {selected && <TestInvokePanel serverId={s.id} tool={t} />}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
