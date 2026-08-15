// src/app/(dashboard)/providers/page.tsx
import { listCatalogProviders } from "@/lib/catalog/index.ts";
import { listProviders } from "@/lib/db/providers.ts";
import { CatalogGrid } from "@/components/dashboard/CatalogGrid.tsx";
import { ProviderCard } from "@/components/dashboard/ProviderCard.tsx";
import { AddProviderForm } from "@/components/dashboard/AddProviderForm.tsx";
import { SectionTitle } from "@/components/dashboard/ui.tsx";

export default function ProvidersPage() {
  const catalog = listCatalogProviders();
  const providers = listProviders();
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

      <section className="flex flex-col gap-3">
        <SectionTitle>Your providers</SectionTitle>
        {providers.length === 0 ? (
          <p className="text-xs text-text-muted">
            No providers configured yet. Add one from the catalog above, or use “Add provider”.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {providers.map((p) => (
              <ProviderCard key={p.id} provider={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
