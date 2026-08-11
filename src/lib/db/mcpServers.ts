// src/lib/db/mcpServers.ts
import { getDb } from "./bootstrap.ts";
import type { McpServer, McpTransport } from "./types.ts";

interface McpServerRow {
  id: number;
  name: string;
  transport: string;
  target: string;
  enabled: number;
  tool_allowlist: string | null;
  confirmed_at: number | null;
}

function toServer(row: McpServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpTransport,
    target: row.target,
    enabled: row.enabled !== 0,
    toolAllowlist: row.tool_allowlist,
    confirmedAt: row.confirmed_at,
  };
}

export function createMcpServer(
  name: string,
  transport: McpTransport,
  target: string,
  opts: Partial<{ enabled: boolean; toolAllowlist: string }> = {}
): number {
  const info = getDb()
    .prepare(
      `INSERT INTO mcp_servers (name, transport, target, enabled, tool_allowlist)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, transport, target, opts.enabled === false ? 0 : 1, opts.toolAllowlist ?? null);
  return Number(info.lastInsertRowid);
}

export function getMcpServer(id: number): McpServer | null {
  const row = getDb().prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as
    McpServerRow | undefined;
  return row ? toServer(row) : null;
}

export function listMcpServers(): McpServer[] {
  const rows = getDb().prepare("SELECT * FROM mcp_servers ORDER BY id").all() as McpServerRow[];
  return rows.map(toServer);
}

export function updateMcpServer(
  id: number,
  patch: Partial<{ name: string; target: string; enabled: boolean; toolAllowlist: string | null }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name);
  }
  if (patch.target !== undefined) {
    sets.push("target = ?");
    params.push(patch.target);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.toolAllowlist !== undefined) {
    sets.push("tool_allowlist = ?");
    params.push(patch.toolAllowlist);
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb()
    .prepare(`UPDATE mcp_servers SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

export function confirmMcpServer(id: number, at: number = Date.now()): void {
  getDb().prepare("UPDATE mcp_servers SET confirmed_at = ? WHERE id = ?").run(at, id);
}

export function deleteMcpServer(id: number): void {
  getDb().prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
}
