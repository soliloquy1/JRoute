// src/components/dashboard/ui.tsx
"use client";

import React from "react";
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

// ── Plan 1b UI primitives (project tokens only; no src/shared/components) ───────

export type StatusTone = "ok" | "warn" | "error" | "idle" | "muted";

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  ok: "bg-success",
  warn: "bg-amber-400",
  error: "bg-error",
  idle: "bg-text-muted",
  muted: "bg-white/20",
};

/** A small colored status dot with an optional label. */
export function StatusDot({ tone, label }: { tone: StatusTone; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", STATUS_TONE_CLASS[tone])} />
      {label && <span className="text-xs text-text-muted">{label}</span>}
    </span>
  );
}

/** Styled `<select>` wrapper. */
export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputClass, className)} />;
}

/** Minimal styled table primitives. */
export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      {...props}
      className={cn("w-full border-collapse text-sm text-text-main", className)}
    />
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      className={cn(
        "border-b border-border px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted",
        className
      )}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} className={cn("border-b border-border px-2 py-1.5", className)} />;
}

/** Controlled modal dialog. Closes on backdrop click and Escape. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-border bg-card shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-text-main">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-control px-2 py-1 text-xs text-text-muted hover:bg-bg-subtle"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

type ToastTone = "ok" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastCtx = React.createContext<{
  toast: (message: string, tone?: ToastTone) => void;
}>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const counter = React.useRef(0);
  const toast = React.useCallback((message: string, tone: ToastTone = "info") => {
    const id = ++counter.current;
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-control border px-3 py-2 text-xs shadow-soft",
              t.tone === "ok" && "border-success/40 bg-success/10 text-success",
              t.tone === "error" && "border-error/40 bg-error/10 text-error",
              t.tone === "info" && "border-border bg-card text-text-main"
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Consume the toast emitter. Must be rendered inside <ToastProvider>. */
export function useToast() {
  return React.useContext(ToastCtx);
}
