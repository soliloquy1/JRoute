// src/components/dashboard/ConnectionRow.tsx
"use client";

import { useRouter } from "next/navigation";
import type { Connection } from "@/lib/db/types.ts";

export function ConnectionRow({
  connection,
  healthy,
}: {
  connection: Connection;
  healthy: boolean;
}) {
  const router = useRouter();

  async function remove() {
    await fetch(`/api/connections/${connection.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between rounded-control border border-border bg-bg-subtle px-3 py-2">
      <div className="flex items-center gap-2 text-sm text-text-main">
        <span className={healthy ? "text-success" : "text-error"}>●</span>
        {connection.label}
        {connection.credentialDecryptFailed && (
          <span className="text-xs text-error">(key undecryptable)</span>
        )}
      </div>
      <button onClick={remove} className="text-xs text-error hover:underline">
        Remove
      </button>
    </div>
  );
}
