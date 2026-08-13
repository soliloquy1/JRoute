"use client";

import Link from "next/link";
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
      <div className="flex items-center gap-2">
        <Link
          href="/change-password"
          className="rounded-control px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle"
        >
          Change password
        </Link>
        <button
          onClick={logout}
          className="rounded-control px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
