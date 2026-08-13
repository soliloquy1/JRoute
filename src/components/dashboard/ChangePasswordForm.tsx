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

  const fieldClass =
    "w-full rounded-control border border-border-strong bg-card px-2.5 py-1.5 text-sm text-text-main focus:border-primary";

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-text-main">
            Change password
          </h1>
          {forced && (
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              This account was created with a temporary password. Choose a new one to
              continue.
            </p>
          )}
        </div>
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-elevated"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              Current password
            </span>
            <input
              type="password"
              className={fieldClass}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">New password</span>
            <input
              type="password"
              className={fieldClass}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              Confirm new password
            </span>
            <input
              type="password"
              className={fieldClass}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {error && <p className="text-xs text-error">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-1 w-full rounded-control bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save new password"}
          </button>
        </form>
      </div>
    </main>
  );
}
