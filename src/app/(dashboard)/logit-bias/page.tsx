// src/app/(dashboard)/logit-bias/page.tsx
import { listLogitBiasPresets } from "@/lib/db/logitBiasPresets.ts";
import { LogitBiasPresetsEditor } from "@/components/dashboard/logitBias/LogitBiasPresetsEditor.tsx";
import { SectionTitle } from "@/components/dashboard/ui.tsx";

export default function LogitBiasPage() {
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle>Logit Bias Presets</SectionTitle>
      <LogitBiasPresetsEditor presets={listLogitBiasPresets()} />
    </div>
  );
}
