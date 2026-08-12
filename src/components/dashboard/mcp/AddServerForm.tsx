// src/components/dashboard/mcp/AddServerForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { McpTransport } from "@/lib/db/types.ts";

const TRANSPORTS: McpTransport[] = ["http", "sse", "stdio"];

export function AddServerForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("http");
  const [target, setTarget] = useState("");
  const [toolAllowlist, setToolAllowlist] = useState("");
  const [triggerPattern, setTriggerPattern] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/mcp-servers", {
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
    setOpen(false);
    setName("");
    setTarget("");
    setToolAllowlist("");
    setTriggerPattern("");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-control bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover"
      >
        Add server
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-card border border-border bg-card p-4"
    >
      <input
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      />
      <select
        value={transport}
        onChange={(e) => setTransport(e.target.value as McpTransport)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      >
        {TRANSPORTS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input
        placeholder={transport === "stdio" ? "Command, e.g. npx some-mcp-server" : "URL"}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      />
      <input
        placeholder="Tool allowlist (comma-separated, optional)"
        value={toolAllowlist}
        onChange={(e) => setToolAllowlist(e.target.value)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      />
      <input
        placeholder="Trigger pattern (regex, optional)"
        value={triggerPattern}
        onChange={(e) => setTriggerPattern(e.target.value)}
        className="rounded-control border border-border bg-bg-subtle p-2 text-sm text-text-main"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-control bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-control px-3 py-1.5 text-sm text-text-main hover:bg-bg-subtle"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
