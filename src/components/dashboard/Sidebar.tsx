// src/components/dashboard/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav.ts";
import { cn } from "@/lib/cn.ts";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[13px] font-semibold text-white">
          J
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-text-main">JRoute</span>
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href.split("#")[0]);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-sm text-text-muted transition-colors hover:bg-bg-subtle hover:text-text-main",
                active && "bg-bg-subtle font-medium text-text-main"
              )}
            >
              <span
                className={cn(
                  "material-symbols-outlined !text-[18px]",
                  active ? "text-primary" : "text-text-muted"
                )}
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-border p-3 text-[11px] leading-relaxed text-text-muted">
        OpenAI-compatible endpoint
        <br />
        at this server&apos;s address
      </div>
    </aside>
  );
}
