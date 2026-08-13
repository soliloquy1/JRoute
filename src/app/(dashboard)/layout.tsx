import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, getDashboardUser, SESSION_COOKIE } from "@/lib/auth/sessions.ts";
import { Sidebar } from "@/components/dashboard/Sidebar.tsx";
import { Topbar } from "@/components/dashboard/Topbar.tsx";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? "";
  const userId = verifySession(token);
  if (userId === null) redirect("/login");
  // Design spec §11: "forced change on first login." A freshly-seeded (or manually
  // seeded) user's must_change flag stays true until changePassword() clears it — every
  // dashboard page redirects here until then. /change-password is its own top-level
  // route (not nested under this layout), so it isn't itself subject to this redirect.
  if (getDashboardUser(userId)?.mustChange) redirect("/change-password");

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
