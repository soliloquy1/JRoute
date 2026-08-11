// src/lib/db/promptBlocks.ts
import { getDb } from "./bootstrap.ts";
import type { PromptBlock, PromptBlockKind } from "./types.ts";

interface PromptBlockRow {
  id: number;
  name: string;
  kind: string;
  content: string;
  created_at: number;
}

function toBlock(row: PromptBlockRow): PromptBlock {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as PromptBlockKind,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function createPromptBlock(name: string, kind: PromptBlockKind, content: string): number {
  const info = getDb()
    .prepare("INSERT INTO prompt_blocks (name, kind, content, created_at) VALUES (?, ?, ?, ?)")
    .run(name, kind, content, Date.now());
  return Number(info.lastInsertRowid);
}

export function getPromptBlock(id: number): PromptBlock | null {
  const row = getDb().prepare("SELECT * FROM prompt_blocks WHERE id = ?").get(id) as
    PromptBlockRow | undefined;
  return row ? toBlock(row) : null;
}

export function listPromptBlocks(kind?: PromptBlockKind): PromptBlock[] {
  const rows = kind
    ? (getDb()
        .prepare("SELECT * FROM prompt_blocks WHERE kind = ? ORDER BY id")
        .all(kind) as PromptBlockRow[])
    : (getDb().prepare("SELECT * FROM prompt_blocks ORDER BY id").all() as PromptBlockRow[]);
  return rows.map(toBlock);
}

export function updatePromptBlock(
  id: number,
  patch: Partial<{ name: string; content: string }>
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name);
  }
  if (patch.content !== undefined) {
    sets.push("content = ?");
    params.push(patch.content);
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb()
    .prepare(`UPDATE prompt_blocks SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

export function deletePromptBlock(id: number): void {
  getDb().prepare("DELETE FROM prompt_blocks WHERE id = ?").run(id);
}
