// src/components/dashboard/ui.tsx
"use client";

import { cn } from "@/lib/cn.ts";

/** Terracotta primary action. */
export function PrimaryButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    />
  );
}

/** Quiet bordered action. */
export function GhostButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "rounded-control border border-border px-3 py-1.5 text-sm text-text-main transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    />
  );
}

/** Small destructive text action. */
export function DangerButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "rounded-control px-2 py-1 text-xs text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    />
  );
}

export const inputClass =
  "w-full rounded-control border border-border-strong bg-card px-2.5 py-1.5 text-sm text-text-main placeholder:text-text-muted/60 transition-colors focus:border-primary";

/** Labeled field wrapper — label above control, 11px muted caps-free label. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Inline mutation error — visible in the UI, not just devtools. */
export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-xs text-error">{message}</p>;
}

/** Quiet empty state with an icon and a call to action. */
export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
      <span className="material-symbols-outlined !text-[28px] text-text-muted">{icon}</span>
      <div className="text-sm font-medium text-text-main">{title}</div>
      {body && <p className="max-w-sm text-xs leading-relaxed text-text-muted">{body}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** Section heading used inside pages. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold tracking-widest text-text-muted uppercase">
      {children}
    </h2>
  );
}
