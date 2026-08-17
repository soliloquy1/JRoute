// src/app/(dashboard)/regex-presets/page.tsx
import { listRegexPresets } from "@/lib/db/regexPresets.ts";
import { RegexPresetsEditor } from "@/components/dashboard/regexPresets/RegexPresetsEditor.tsx";
import { SectionTitle } from "@/components/dashboard/ui.tsx";

export default function RegexPresetsPage() {
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle>Regex Presets</SectionTitle>
      <RegexPresetsEditor presets={listRegexPresets()} />
    </div>
  );
}
