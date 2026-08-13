import { listProviders } from "@/lib/db/providers.ts";
import { ProviderCard } from "@/components/dashboard/ProviderCard.tsx";
import { AddProviderForm } from "@/components/dashboard/AddProviderForm.tsx";
import { EmptyState } from "@/components/dashboard/ui.tsx";

export default function ProvidersPage() {
  const providers = listProviders();
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          {providers.length === 0
            ? "No providers configured"
            : `${providers.length} provider${providers.length === 1 ? "" : "s"} · drag connections to set failover order`}
        </p>
        <AddProviderForm />
      </div>
      {providers.length === 0 ? (
        <EmptyState
          icon="cable"
          title="No providers yet"
          body="A provider is an upstream LLM API (OpenAI, Anthropic, Gemini, or any compatible endpoint). Add one, then attach a connection with its API key."
        >
          <span className="text-xs text-text-muted">Use the Add provider button above.</span>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      )}
    </div>
  );
}
