import { listApiKeys } from "@/lib/auth/apiKeys.ts";
import { listPresets } from "@/lib/db/presets.ts";
import { KeyTable } from "@/components/dashboard/KeyTable.tsx";
import { GenerateKeyDialog } from "@/components/dashboard/GenerateKeyDialog.tsx";

export default function KeysPage() {
  const keys = listApiKeys();
  const presets = listPresets();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-main">API keys</h1>
        <GenerateKeyDialog />
      </div>
      <KeyTable keys={keys} presets={presets} />
    </div>
  );
}
