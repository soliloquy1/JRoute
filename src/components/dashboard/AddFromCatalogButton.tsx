// src/components/dashboard/AddFromCatalogButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATALOG_PROVIDERS, type CatalogProvider } from "@/lib/catalog/providers.ts";
import { GhostButton, Modal, useToast } from "./ui.tsx";

/**
 * Re-add a catalog provider the operator previously removed. Catalog providers
 * auto-seed at boot, so this normally has nothing to show — it only surfaces entries
 * whose id isn't already in `providers` (i.e. explicitly deleted; deleted_catalog_
 * provider_ids keeps seedCatalogProviders() from bringing them back on its own).
 */
export function AddFromCatalogButton({ existingIds }: { existingIds: string[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const missing = CATALOG_PROVIDERS.filter(
    (c) => c.wireFormat !== null && !existingIds.includes(c.id)
  );
  if (missing.length === 0) return null;

  async function add(entry: CatalogProvider) {
    if (addingId) return;
    setAddingId(entry.id);
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
          overwrite: true,
        }),
      });
      if (!res.ok) {
        toast(`Failed to add ${entry.name}`, "error");
        return;
      }
      toast(`Added ${entry.name}`, "ok");
      setOpen(false);
      router.refresh();
    } finally {
      setAddingId(null);
    }
  }

  return (
    <>
      <GhostButton onClick={() => setOpen(true)}>From catalog</GhostButton>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Add a catalog provider">
          <div className="flex flex-col gap-2">
            {missing.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2"
              >
                <span className="text-sm text-text-main">{entry.name}</span>
                <GhostButton onClick={() => add(entry)} disabled={addingId === entry.id}>
                  {addingId === entry.id ? "Adding…" : "Add"}
                </GhostButton>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
