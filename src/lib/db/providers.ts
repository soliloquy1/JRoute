// src/lib/db/providers.ts
import { getDb } from "./bootstrap.ts";
import type { Provider, ProviderKind, WireFormat } from "./types.ts";

interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  wire_format: string;
  enabled: number;
}

function toProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderKind,
    baseUrl: row.base_url,
    wireFormat: row.wire_format as WireFormat,
    enabled: row.enabled !== 0,
  };
}

export function listProviders(): Provider[] {
  const rows = getDb().prepare("SELECT * FROM providers ORDER BY id").all() as ProviderRow[];
  return rows.map(toProvider);
}

export function getProvider(id: string): Provider | null {
  const row = getDb().prepare("SELECT * FROM providers WHERE id = ?").get(id) as
    ProviderRow | undefined;
  return row ? toProvider(row) : null;
}

export function upsertProvider(p: Provider): void {
  getDb()
    .prepare(
      `INSERT INTO providers (id, name, kind, base_url, wire_format, enabled)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         base_url = excluded.base_url,
         wire_format = excluded.wire_format,
         enabled = excluded.enabled`
    )
    .run(p.id, p.name, p.kind, p.baseUrl, p.wireFormat, p.enabled ? 1 : 0);
}
