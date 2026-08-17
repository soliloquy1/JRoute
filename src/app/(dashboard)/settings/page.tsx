// src/app/(dashboard)/settings/page.tsx
import { getFallbackStrategy } from "@/lib/db/settings.ts";
import { FallbackStrategyForm } from "@/components/dashboard/FallbackStrategyForm.tsx";

export default function SettingsPage() {
  const strategy = getFallbackStrategy();
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <h1 className="text-lg font-semibold text-text-main">Settings</h1>
      <FallbackStrategyForm initialStrategy={strategy} />
    </div>
  );
}
