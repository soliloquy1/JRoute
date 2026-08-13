// src/app/change-password/page.tsx
//
// Deliberately its own top-level route, NOT nested under (dashboard) — the dashboard
// layout redirects here whenever a user's must_change flag is true, so this page must be
// reachable without triggering that same redirect (or it's an infinite loop). It does its
// own session check (must be logged in), but never checks/enforces must_change itself —
// that's what makes it usable both for the forced first-login case and for a voluntary
// password change later (linked from Topbar) once must_change is already false.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, getDashboardUser, SESSION_COOKIE } from "@/lib/auth/sessions.ts";
import { ChangePasswordForm } from "@/components/dashboard/ChangePasswordForm.tsx";

export default async function ChangePasswordPage() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? "";
  const userId = verifySession(token);
  if (userId === null) redirect("/login");

  const user = getDashboardUser(userId);
  return <ChangePasswordForm forced={user?.mustChange ?? false} />;
}
