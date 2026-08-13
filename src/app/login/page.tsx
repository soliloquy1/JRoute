"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
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
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-xs">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-white">
            J
          </span>
          <h1 className="text-lg font-semibold tracking-tight text-text-main">
            Sign in to JRoute
          </h1>
        </div>
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-elevated"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">Username</span>
            <input
              className="w-full rounded-control border border-border-strong bg-card px-2.5 py-1.5 text-sm text-text-main focus:border-primary"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">Password</span>
            <input
              type="password"
              className="w-full rounded-control border border-border-strong bg-card px-2.5 py-1.5 text-sm text-text-main focus:border-primary"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p className="text-xs text-error">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-1 w-full rounded-control bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
