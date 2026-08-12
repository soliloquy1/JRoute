// src/components/dashboard/RemoveProviderButton.tsx
"use client";

import { useRouter } from "next/navigation";

export function RemoveProviderButton({ providerId }: { providerId: string }) {
  const router = useRouter();

  async function remove() {
    if (!window.confirm("Remove this provider?")) return;
    const res = await fetch(`/api/providers/${providerId}`, { method: "DELETE" });
    if (!res.ok) {
      console.error("Failed to remove provider", providerId);
      return;
    }
    router.refresh();
  }

  return (
    <button onClick={remove} className="text-xs text-error hover:underline">
      Remove provider
    </button>
  );
}
