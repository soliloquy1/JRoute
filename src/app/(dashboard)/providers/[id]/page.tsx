// src/app/(dashboard)/providers/[id]/page.tsx
import { notFound } from "next/navigation";
import { getProvider } from "@/lib/db/providers.ts";
import { listConnections } from "@/lib/db/connections.ts";
import { listModels } from "@/lib/db/models.ts";
import { ProviderDetailView } from "@/components/dashboard/ProviderDetailView.tsx";

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const provider = getProvider(id);
  if (!provider) notFound();

  const models = listModels(id).map((m) => ({
    providerId: m.providerId,
    modelId: m.modelId,
    clientId: m.clientId,
    enabled: m.enabled,
  }));
  const connections = listConnections(id);

  return <ProviderDetailView provider={provider} models={models} connections={connections} />;
}
