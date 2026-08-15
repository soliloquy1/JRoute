// src/app/(dashboard)/providers/page.tsx
import { listCatalogProviders } from "@/lib/catalog/index.ts";
import { CatalogGrid } from "@/components/dashboard/CatalogGrid.tsx";
import { AddProviderForm } from "@/components/dashboard/AddProviderForm.tsx";

export default function ProvidersPage() {
  const catalog = listCatalogProviders();
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Providers</h1>
          <p className="text-xs text-text-muted">
            {catalog.length} curated provider{catalog.length === 1 ? "" : "s"} · add one, then
            attach a connection with its API key or OAuth token
          </p>
        </div>
        <AddProviderForm />
      </div>
      <CatalogGrid entries={catalog} />
    </div>
  );
}
