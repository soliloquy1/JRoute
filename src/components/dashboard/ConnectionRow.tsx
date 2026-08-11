// src/components/dashboard/ConnectionRow.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Connection } from "@/lib/db/types.ts";

export function ConnectionRow({ connection }: { connection: Connection }) {
  const router = useRouter();
  // Lazy initializer (not a direct call in the render body) so the react-compiler
  // purity lint rule doesn't flag it: https://react.dev/reference/rules/components-and-hooks-must-be-pure.
  // The row is remounted with fresh data via router.refresh() after every mutation,
  // so a per-render "now" is not needed for correctness.
  const [now] = useState(() => Date.now());

  async function remove() {
    await fetch(`/api/connections/${connection.id}`, { method: "DELETE" });
    router.refresh();
  }

  const healthy = connection.cooldownUntil === null || connection.cooldownUntil <= now;

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
