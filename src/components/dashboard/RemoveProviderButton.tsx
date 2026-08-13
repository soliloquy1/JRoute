// src/components/dashboard/RemoveProviderButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RemoveProviderButton({ providerId }: { providerId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm("Remove this provider and all its connections?")) return;
    setError(null);
    const res = await fetch(`/api/providers/${providerId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to remove");
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      {error && <span className="text-[11px] text-error">{error}</span>}
      <button
        onClick={remove}
        className="rounded-control px-2 py-1 text-xs text-text-muted transition-colors hover:bg-error/10 hover:text-error"
      >
        Remove
      </button>
    </span>
  );
}
