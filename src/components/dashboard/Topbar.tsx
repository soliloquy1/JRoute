// src/components/dashboard/Topbar.tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { NAV_ITEMS } from "./nav.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

function titleFor(pathname: string): string {
  if (pathname === "/") return "Overview";
  const item = NAV_ITEMS.find(
    (i) => i.href !== "/" && pathname.startsWith(i.href.split("#")[0])
  );
  return item?.label ?? "JRoute";
}

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg px-6">
      <h1 className="text-[15px] font-semibold tracking-tight text-text-main">
        {titleFor(pathname)}
      </h1>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <button
          onClick={() => router.push("/change-password")}
          aria-label="Change password"
          title="Change password"
          className="flex h-8 w-8 items-center justify-center rounded-control text-text-muted hover:bg-bg-subtle hover:text-text-main"
        >
          <span className="material-symbols-outlined !text-[18px]">lock</span>
        </button>
        <button
          onClick={logout}
          aria-label="Log out"
          title="Log out"
          className="flex h-8 w-8 items-center justify-center rounded-control text-text-muted hover:bg-bg-subtle hover:text-text-main"
        >
          <span className="material-symbols-outlined !text-[18px]">logout</span>
        </button>
      </div>
    </header>
  );
}
