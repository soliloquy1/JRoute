// src/components/dashboard/ProviderGridCard.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Connection, Provider } from "@/lib/db/types.ts";
import { useToast } from "./ui.tsx";

function isConnectionHealthy(connection: Connection, now: number): boolean {
  return (
    connection.enabled &&
    !connection.credentialDecryptFailed &&
    (connection.cooldownUntil === null || connection.cooldownUntil <= now)
  );
}

export function ProviderGridCard({
  provider,
  connections,
  icon,
  color,
}: {
  provider: Provider;
  connections: Connection[];
  icon: string;
  color: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);

  const now = Date.now();
  const healthyCount = connections.filter((c) => isConnectionHealthy(c, now)).length;
  const primary = [...connections].sort((a, b) => a.priority - b.priority || a.id - b.id)[0];

  async function toggleEnabled(e: React.MouseEvent) {
    e.preventDefault();
    if (toggling) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(provider.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !provider.enabled }),
      });
      if (!res.ok) {
        toast("Failed to update provider", "error");
        return;
      }
      router.refresh();
    } finally {
      setToggling(false);
    }
  }

  async function runTest(e: React.MouseEvent) {
    e.preventDefault();
    if (testing || !primary) return;
    setTesting(true);
    try {
      const res = await fetch(`/api/connections/${primary.id}/test`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok: boolean; error: string | null } | null;
      toast(body?.ok ? `${provider.name}: OK` : `${provider.name}: ${body?.error ?? "Failed"}`, body?.ok ? "ok" : "error");
      router.refresh();
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-3.5 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/providers/${encodeURIComponent(provider.id)}`}
          className="flex min-w-0 items-center gap-2.5"
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-control"
            style={{ backgroundColor: `${color}22`, color }}
          >
            {/* An icon value that isn't a real Material Symbols ligature name (e.g. a
                bad catalog entry) renders as literal fallback text instead of a glyph —
                overflow-hidden on the fixed 32px box keeps that contained instead of
                blowing out the whole card grid (see catalog/providers.ts history). */}
            <span className="material-symbols-outlined !text-[18px] leading-none">{icon}</span>
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-text-main">{provider.name}</span>
        </Link>
        <button
          onClick={toggleEnabled}
          disabled={toggling}
          role="switch"
          aria-checked={provider.enabled}
          title={provider.enabled ? "Disable provider" : "Enable provider"}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            provider.enabled ? "bg-primary" : "bg-bg-subtle"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
              provider.enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        {connections.length === 0 ? (
          <span className="text-xs text-text-muted">No connections</span>
        ) : (
          <span className={`text-xs ${healthyCount > 0 ? "text-success" : "text-error"}`}>
            {healthyCount} / {connections.length} connected
          </span>
        )}
        <button
          onClick={runTest}
          disabled={testing || !primary}
          className="flex shrink-0 items-center gap-1 rounded-control border border-border px-2 py-1 text-xs text-text-main transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="material-symbols-outlined !text-[13px]">play_arrow</span>
          {testing ? "Testing…" : "Test"}
        </button>
      </div>
    </div>
  );
}
