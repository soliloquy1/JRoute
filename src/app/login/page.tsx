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
    <main className="flex min-h-screen items-center justify-center bg-bg">
      <form
        onSubmit={onSubmit}
        className="w-80 rounded-card border border-border bg-surface p-6 shadow-elevated"
      >
        <h1 className="mb-4 text-lg font-semibold text-text-main">JRoute</h1>
        <label className="mb-2 block text-sm text-text-muted">
          Username
          <input
            className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-2 text-text-main"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="mb-4 block text-sm text-text-muted">
          Password
          <input
            type="password"
            className="mt-1 w-full rounded-control border border-border bg-bg-subtle p-2 text-text-main"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="mb-3 text-sm text-error">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-control bg-primary p-2 font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
