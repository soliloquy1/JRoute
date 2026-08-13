// src/components/dashboard/mcp/AddServerForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { McpTransport } from "@/lib/db/types.ts";
import { PrimaryButton, GhostButton, Field, inputClass, InlineError } from "../ui.tsx";

const TRANSPORTS: McpTransport[] = ["http", "sse", "stdio"];

export function AddServerForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("http");
  const [target, setTarget] = useState("");
  const [toolAllowlist, setToolAllowlist] = useState("");
  const [triggerPattern, setTriggerPattern] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        transport,
        target,
        toolAllowlist: toolAllowlist || undefined,
        triggerPattern: triggerPattern || undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "Failed to add server");
      return;
    }
    setOpen(false);
    setName("");
    setTarget("");
    setToolAllowlist("");
    setTriggerPattern("");
    router.refresh();
  }

  if (!open) {
    return <PrimaryButton onClick={() => setOpen(true)}>Add server</PrimaryButton>;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-md flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-soft"
    >
      <div className="text-sm font-semibold text-text-main">New MCP server</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input
            placeholder="web-search"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Transport">
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as McpTransport)}
            className={inputClass}
          >
            {TRANSPORTS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={transport === "stdio" ? "Command" : "URL"}>
        <input
          placeholder={transport === "stdio" ? "npx some-mcp-server" : "https://…"}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className={`${inputClass} font-mono text-[13px]`}
        />
      </Field>
      {transport === "stdio" && (
        <p className="rounded-control bg-warning/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-warning">
          stdio servers spawn a local process on this machine. You will be asked to confirm
          before the first spawn.
        </p>
      )}
      <Field label="Tool allowlist (optional)">
        <input
          placeholder="search, fetch — comma-separated"
          value={toolAllowlist}
          onChange={(e) => setToolAllowlist(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Trigger pattern (optional)">
        <input
          placeholder="\bsearch\b — regex matched against the last user message"
          value={triggerPattern}
          onChange={(e) => setTriggerPattern(e.target.value)}
          className={`${inputClass} font-mono text-[13px]`}
        />
      </Field>
      <InlineError message={error} />
      <div className="flex gap-2">
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save server"}
        </PrimaryButton>
        <GhostButton type="button" onClick={() => setOpen(false)}>
          Cancel
        </GhostButton>
      </div>
    </form>
  );
}
