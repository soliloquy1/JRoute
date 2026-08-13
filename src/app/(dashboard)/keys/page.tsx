import { listApiKeys } from "@/lib/auth/apiKeys.ts";
import { listPresets } from "@/lib/db/presets.ts";
import { listRichPresets } from "@/lib/db/richPresets.ts";
import { getRecentUsage, getUsageByApiKey } from "@/lib/db/usageLogs.ts";
import { KeyTable } from "@/components/dashboard/KeyTable.tsx";
import { GenerateKeyDialog } from "@/components/dashboard/GenerateKeyDialog.tsx";
import { LogTable } from "@/components/dashboard/LogTable.tsx";
import { SectionTitle } from "@/components/dashboard/ui.tsx";

export default async function KeysPage({
  searchParams,
}: {
  searchParams: Promise<{ apiKeyId?: string }>;
}) {
  const { apiKeyId } = await searchParams;
  const keys = listApiKeys();
  const presets = listPresets();
  const richPresets = listRichPresets();
  const logs = apiKeyId ? getUsageByApiKey(Number(apiKeyId), 50) : getRecentUsage(50);
  const filterKey = apiKeyId ? keys.find((k) => k.id === Number(apiKeyId)) : null;

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Keys</SectionTitle>
          <GenerateKeyDialog />
        </div>
        <KeyTable keys={keys} presets={presets} richPresets={richPresets} />
      </section>

      <section id="log" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Request log</SectionTitle>
          {keys.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <a
                href="/keys#log"
                className={`rounded-full px-2.5 py-1 transition-colors ${
                  !filterKey
                    ? "bg-primary-soft font-medium text-primary"
                    : "text-text-muted hover:bg-bg-subtle hover:text-text-main"
                }`}
              >
                all keys
              </a>
              {keys.map((k) => (
                <a
                  key={k.id}
                  href={`/keys?apiKeyId=${k.id}#log`}
                  className={`rounded-full px-2.5 py-1 transition-colors ${
                    filterKey?.id === k.id
                      ? "bg-primary-soft font-medium text-primary"
                      : "text-text-muted hover:bg-bg-subtle hover:text-text-main"
                  }`}
                >
                  {k.label}
                </a>
              ))}
            </div>
          )}
        </div>
        <LogTable rows={logs} keys={keys} />
      </section>
    </div>
  );
}
