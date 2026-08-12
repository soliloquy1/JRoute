// src/app/(dashboard)/prompts/page.tsx
import { listPromptBlocks } from "@/lib/db/promptBlocks.ts";
import { listLorebooks } from "@/lib/db/lorebooks.ts";
import { listPresets } from "@/lib/db/presets.ts";
import { PromptsEditor } from "@/components/dashboard/prompts/PromptsEditor.tsx";

export default function PromptsPage() {
  return (
    <PromptsEditor
      blocks={listPromptBlocks()}
      lorebooks={listLorebooks()}
      presets={listPresets()}
    />
  );
}
