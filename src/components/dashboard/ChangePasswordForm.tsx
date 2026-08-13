// src/components/dashboard/ChangePasswordForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/account/password", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = (await res.json()) as { error: { message: string } };
      setError(body.error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg">
      <form
        onSubmit={onSubmit}
        className="w-96 rounded-card border border-border bg-surface p-6 shadow-elevated"
      >
        <h1 className="mb-2 text-lg font-semibold text-text-main">Change password</h1>
        {forced && (
          <p className="mb-4 text-sm text-text-muted">
            This account was created with a temporary password. Choose a new one to continue.
          </p>
        )}
        <label className="mb-2 block text-sm text-text-muted">
          Current password
          <input
            type="password"
            className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-2 text-text-main"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label className="mb-2 block text-sm text-text-muted">
          New password
          <input
            type="password"
            className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-2 text-text-main"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className="mb-4 block text-sm text-text-muted">
          Confirm new password
          <input
            type="password"
            className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-2 text-text-main"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error && <p className="mb-3 text-sm text-error">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-control bg-primary p-2 font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save new password"}
        </button>
      </form>
    </main>
  );
}
