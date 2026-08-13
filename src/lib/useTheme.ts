// src/lib/useTheme.ts
"use client";

import { useSyncExternalStore } from "react";

/**
 * Live view of the active theme (the `.dark` class on <html>, set by the inline script
 * in app/layout.tsx). useSyncExternalStore is the hydration-safe pattern for this: the
 * server snapshot says "dark" (matching the layout's fallback), and React re-renders
 * with the real client value after hydration — no setState-in-effect, no FOUC.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

function getServerSnapshot(): boolean {
  return true; // layout's no-FOUC fallback is dark
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function toggleTheme(currentlyDark: boolean): void {
  const next = !currentlyDark;
  document.documentElement.classList.toggle("dark", next);
  try {
    localStorage.setItem("jroute-theme", next ? "dark" : "light");
  } catch {
    // private mode etc. — theme just won't persist
  }
}
