// src/components/dashboard/CatalogGrid.tsx
"use client";

import { useMemo, useState } from "react";
import { CatalogAddButton } from "./CatalogAddButton.tsx";
import { EmptyState, SectionTitle } from "./ui.tsx";
import { matchesSearch } from "@/shared/utils/turkishText.ts";
import type { CatalogProvider, CatalogCategory } from "@/lib/catalog/providers.ts";

const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  oauth: "OAuth providers",
  apikey: "API-key providers",
  compatible: "Custom / compatible",
  local: "Local",
};

const CATEGORY_ORDER: CatalogCategory[] = ["oauth", "apikey", "compatible", "local"];

const WIRE_BADGE: Record<string, string> = {
  openai: "bg-emerald-500/15 text-emerald-300",
  anthropic: "bg-orange-500/15 text-orange-300",
  gemini: "bg-sky-500/15 text-sky-300",
};

export function CatalogGrid({ entries }: { entries: CatalogProvider[] }) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) => matchesSearch(e.name, q) || matchesSearch(e.id, q)
        )
      : entries;
    const map = new Map<CatalogCategory, CatalogProvider[]>();
    for (const e of filtered) {
      if (!map.has(e.category)) map.set(e.category, []);
      map.get(e.category)!.push(e);
    }
    return map;
  }, [entries, query]);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon="cable"
        title="No providers in catalog"
        body="The provider catalog is empty. Add a custom provider to get started."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search providers…"
        className="w-full max-w-sm rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-text outline-none focus:border-white/25"
      />
      {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => (
        <section key={category} className="flex flex-col gap-3">
          <SectionTitle>{CATEGORY_LABELS[category]}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {grouped.get(category)!.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-text">{entry.name}</p>
                    <p className="text-xs text-text-muted">{entry.baseUrl}</p>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase ${
                      WIRE_BADGE[entry.wireFormat ?? ""] ?? "bg-white/10 text-text-muted"
                    }`}
                  >
                    {entry.wireFormat}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">
                    {entry.kind} · {entry.id}
                  </span>
                  <CatalogAddButton entry={entry} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
