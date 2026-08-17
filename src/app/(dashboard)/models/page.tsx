// src/app/(dashboard)/models/page.tsx
import { listProviders } from "@/lib/db/providers.ts";
import { listConnections } from "@/lib/db/connections.ts";
import { categoryForProvider, getCatalogProvider } from "@/lib/catalog/index.ts";
import { ProviderGridCard } from "@/components/dashboard/ProviderGridCard.tsx";
import { AddProviderButton } from "@/components/dashboard/AddProviderButton.tsx";
import { AddFromCatalogButton } from "@/components/dashboard/AddFromCatalogButton.tsx";
import { SectionTitle, ToastProvider } from "@/components/dashboard/ui.tsx";
import type { Provider } from "@/lib/db/types.ts";

const CATEGORY_LABEL: Record<string, string> = {
  oauth: "OAuth Providers",
  apikey: "API Key Providers",
  compatible: "Compatible Providers",
  local: "Local Providers",
};

// Rendered in this fixed order; a category with zero providers is skipped entirely
// rather than shown as a permanent empty section.
const CATEGORY_ORDER = ["oauth", "apikey", "compatible", "local"];

const DEFAULT_ICON = "cable";
const DEFAULT_COLOR = "#8B8B93";

function iconFor(provider: Provider): { icon: string; color: string } {
  const entry = getCatalogProvider(provider.id);
  return { icon: entry?.icon ?? DEFAULT_ICON, color: entry?.color ?? DEFAULT_COLOR };
}

export default function ModelsPage() {
  const providers = listProviders();
  const byCategory = new Map<string, Provider[]>();
  for (const p of providers) {
    const category = categoryForProvider(p.id);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(p);
  }

  const connectedProviderCount = providers.filter((p) => listConnections(p.id).length > 0).length;

  return (
    <ToastProvider>
      <div className="flex max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-text-main">Models</h1>
            <p className="text-xs text-text-muted">
              {connectedProviderCount}/{providers.length} providers configured · click a provider
              to manage its connections and models
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AddFromCatalogButton existingIds={providers.map((p) => p.id)} />
            <AddProviderButton existingIds={providers.map((p) => p.id)} />
          </div>
        </div>

        {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => {
          const entries = byCategory.get(category)!;
          const configured = entries.filter((p) => listConnections(p.id).length > 0).length;
          return (
            <section key={category} className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <SectionTitle>{CATEGORY_LABEL[category] ?? category}</SectionTitle>
                <span className="text-[11px] text-text-muted">
                  {configured}/{entries.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {entries.map((p) => {
                  const { icon, color } = iconFor(p);
                  return (
                    <ProviderGridCard
                      key={p.id}
                      provider={p}
                      connections={listConnections(p.id)}
                      icon={icon}
                      color={color}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </ToastProvider>
  );
}
