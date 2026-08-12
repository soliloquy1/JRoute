"use client";

import { usePathname, useRouter } from "next/navigation";

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b border-border bg-bg px-6 py-3">
      <div className="text-sm text-text-muted">{pathname}</div>
      <button
        onClick={logout}
        className="rounded-control px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle"
      >
        Log out
      </button>
    </header>
  );
}
