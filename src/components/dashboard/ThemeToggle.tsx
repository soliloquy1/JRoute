// src/components/dashboard/ThemeToggle.tsx
"use client";

import { useIsDark, toggleTheme } from "@/lib/useTheme.ts";

export function ThemeToggle() {
  const isDark = useIsDark();

  return (
    <button
      onClick={() => toggleTheme(isDark)}
      aria-label="Toggle theme"
      className="flex h-8 w-8 items-center justify-center rounded-control text-text-muted hover:bg-bg-subtle hover:text-text-main"
    >
      <span className="material-symbols-outlined">
        {isDark ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
