import { listProviders } from "@/lib/db/providers.ts";
import { ProviderCard } from "@/components/dashboard/ProviderCard.tsx";
import { AddProviderForm } from "@/components/dashboard/AddProviderForm.tsx";

export default function ProvidersPage() {
  const providers = listProviders();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-main">Providers</h1>
        <AddProviderForm />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>
    </div>
  );
}
