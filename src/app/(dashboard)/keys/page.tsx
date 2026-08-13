import { listApiKeys } from "@/lib/auth/apiKeys.ts";
import { listPresets } from "@/lib/db/presets.ts";
import { listRichPresets } from "@/lib/db/richPresets.ts";
import { getRecentUsage, getUsageByApiKey } from "@/lib/db/usageLogs.ts";
import { KeyTable } from "@/components/dashboard/KeyTable.tsx";
import { GenerateKeyDialog } from "@/components/dashboard/GenerateKeyDialog.tsx";
import { LogTable } from "@/components/dashboard/LogTable.tsx";

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-main">API keys</h1>
        <GenerateKeyDialog />
      </div>
      <KeyTable keys={keys} presets={presets} richPresets={richPresets} />

      <div id="log" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-main">Request log</h2>
          <div className="flex gap-2 text-xs">
            <a href="/keys#log" className="text-accent hover:underline">
              all keys
            </a>
            {keys.map((k) => (
              <a
                key={k.id}
                href={`/keys?apiKeyId=${k.id}#log`}
                className="text-accent hover:underline"
              >
                {k.label}
              </a>
            ))}
          </div>
        </div>
        <LogTable rows={logs} keys={keys} />
      </div>
    </div>
  );
}
