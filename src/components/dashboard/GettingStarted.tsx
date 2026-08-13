// src/components/dashboard/GettingStarted.tsx
import Link from "next/link";

/**
 * Shown on the overview when the install is fresh (nothing configured yet). The setup
 * order is the real dependency chain: provider → connection → key → preset → chat.
 */
const STEPS = [
  {
    n: 1,
    title: "Add a provider",
    body: "Point JRoute at an LLM provider (OpenAI, Anthropic, Gemini, or any compatible endpoint) and add a connection with its API key.",
    href: "/providers",
    cta: "Open Providers",
  },
  {
    n: 2,
    title: "Generate an API key",
    body: "Keys are what your client (SillyTavern, Janitor-compatible frontends) authenticates with. Each key can carry its own preset.",
    href: "/keys",
    cta: "Open API Keys",
  },
  {
    n: 3,
    title: "Import a SillyTavern preset",
    body: "Drop in a preset JSON exported from SillyTavern. Its prompt order, samplers, and macros become the pipeline your chats run through.",
    href: "/rich-presets",
    cta: "Open Presets",
  },
  {
    n: 4,
    title: "Point your client at JRoute",
    body: "In SillyTavern, use an OpenAI-compatible endpoint at this server's address, with the key from step 2.",
    href: null,
    cta: null,
  },
];

export function GettingStarted({
  hasProviders,
  hasKeys,
  hasPresets,
}: {
  hasProviders: boolean;
  hasKeys: boolean;
  hasPresets: boolean;
}) {
  const done = [hasProviders, hasKeys, hasPresets, false];
  return (
    <div className="rounded-card border border-border bg-card p-5 shadow-soft">
      <div className="mb-1 text-sm font-semibold text-text-main">
        {done.slice(0, 3).every(Boolean) ? "Almost there" : "Welcome to JRoute"}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-text-muted">
        {done.slice(0, 3).every(Boolean)
          ? "Last step: point your client at this server."
          : "Setup is a four-step chain — each step depends on the one before it:"}
      </p>
      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <li key={step.n} className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${
                done[i] ? "bg-success/15 text-success" : "bg-primary-soft text-primary"
              }`}
            >
              {done[i] ? "✓" : step.n}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text-main">{step.title}</div>
              <p className="text-xs leading-relaxed text-text-muted">{step.body}</p>
            </div>
            {step.href && (
              <Link
                href={step.href}
                className="shrink-0 rounded-control border border-border px-2.5 py-1 text-xs text-text-main transition-colors hover:bg-bg-subtle"
              >
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
