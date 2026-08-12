"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "./nav.ts";
import { cn } from "@/lib/cn.ts";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 flex-col gap-6 border-r border-border bg-sidebar p-4">
      <div className="px-2 text-lg font-semibold text-text-main">JRoute</div>
      {NAV_GROUPS.map((g) => (
        <div key={g.group}>
          <div className="mb-2 px-2 text-xs font-medium tracking-wide text-text-muted">
            {g.group}
          </div>
          <nav className="flex flex-col gap-1">
            {g.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-control px-2 py-1.5 text-sm text-text-main hover:bg-bg-subtle",
                  pathname === item.href.split("#")[0] && "bg-bg-subtle font-medium"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      ))}
    </aside>
  );
}
