import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/sessions.ts";
import { SESSION_COOKIE } from "@/lib/auth/sessions.ts";
import { Sidebar } from "@/components/dashboard/Sidebar.tsx";
import { Topbar } from "@/components/dashboard/Topbar.tsx";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? "";
  if (verifySession(token) === null) redirect("/login");

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
