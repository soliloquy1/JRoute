// src/app/(dashboard)/models/page.tsx
import { listModels } from "@/lib/db/models.ts";
import { listProviders } from "@/lib/db/providers.ts";
import { ModelsManager } from "@/components/dashboard/ModelsManager.tsx";

export default function ModelsPage() {
  const models = listModels();
  const providers = listProviders();
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-text-main">Models</h1>
        <p className="mt-0.5 text-xs text-text-muted">
          Models are scoped to the provider that serves them. Request a model as{" "}
          <code className="rounded bg-bg-subtle px-1 py-0.5">prefix/nativeId</code> (e.g.{" "}
          <code className="rounded bg-bg-subtle px-1 py-0.5">or/gpt-5.6-sol</code>) so it routes only
          to that provider. Use <strong>Import from provider</strong> to pull a provider&apos;s live
          model list.
        </p>
      </div>
      <ModelsManager initialModels={models} providers={providers} />
    </div>
  );
}
