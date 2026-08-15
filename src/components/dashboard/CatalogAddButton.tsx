// src/components/dashboard/CatalogAddButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton } from "./ui.tsx";
import type { CatalogProvider } from "@/lib/catalog/providers.ts";

/**
 * Adds a curated catalog provider to the operator's configured providers (idempotent
 * upsert). Mirrors the dashboard add-provider modal's fetch shape but seeded from the
 * catalog entry, so the catalog grid is directly actionable.
 */
export function CatalogAddButton({ entry }: { entry: CatalogProvider }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: entry.id,
          name: entry.name,
          kind: entry.kind,
          baseUrl: entry.baseUrl,
          wireFormat: entry.wireFormat,
          enabled: true,
          modelPrefix: entry.modelPrefix ?? "",
          oauthProvider: entry.oauthProvider ?? undefined,
          providerSpecificData: entry.providerSpecificDefaults ?? undefined,
          // Catalog adds are an intentional idempotent upsert (mirrors seeding); the
          // add-provider modal is create-only and omits this, so it gets the 409 guard.
          overwrite: true,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string | { message?: string };
        } | null;
        const msg =
          typeof body?.error === "string"
            ? body.error
            : body?.error?.message ?? "Failed to add provider";
        setError(msg);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — could not add provider");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <PrimaryButton onClick={onAdd} disabled={saving}>
        {saving ? "Adding…" : "Add"}
      </PrimaryButton>
      {error && <span className="text-xs text-error">{error}</span>}
    </div>
  );
}
