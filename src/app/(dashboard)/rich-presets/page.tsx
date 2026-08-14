// src/app/(dashboard)/rich-presets/page.tsx
import { listRichPresets } from "@/lib/db/richPresets.ts";
import { listLorebooks } from "@/lib/db/lorebooks.ts";
import { listApiKeys } from "@/lib/auth/apiKeys.ts";
import { richPresetKeyLabels } from "@/lib/dashboard/presetUsage.ts";
import { RichPresetsEditor } from "@/components/dashboard/richPresets/RichPresetsEditor.tsx";

export default function RichPresetsPage() {
  const keyLabelsByPreset = richPresetKeyLabels(listApiKeys());
  return (
    <RichPresetsEditor
      presets={listRichPresets()}
      lorebooks={listLorebooks()}
      keyLabelsByPreset={keyLabelsByPreset}
    />
  );
}
