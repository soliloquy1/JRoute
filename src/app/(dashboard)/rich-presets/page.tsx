// src/app/(dashboard)/rich-presets/page.tsx
import { listRichPresets } from "@/lib/db/richPresets.ts";
import { listLorebooks } from "@/lib/db/lorebooks.ts";
import { RichPresetsEditor } from "@/components/dashboard/richPresets/RichPresetsEditor.tsx";

export default function RichPresetsPage() {
  return <RichPresetsEditor presets={listRichPresets()} lorebooks={listLorebooks()} />;
}
