// src/components/dashboard/RemoveProviderButton.tsx
"use client";

import { useRouter } from "next/navigation";

export function RemoveProviderButton({ providerId }: { providerId: string }) {
  const router = useRouter();

  async function remove() {
    await fetch(`/api/providers/${providerId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <button onClick={remove} className="text-xs text-error hover:underline">
      Remove provider
    </button>
  );
}
