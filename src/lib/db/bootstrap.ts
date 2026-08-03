import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrationRunner.ts";
import type { SqliteAdapter } from "./adapters/types.ts";

let instance: SqliteAdapter | null = null;

export function dataDir(): string {
  const dir = process.env.DATA_DIR || join(homedir(), ".jroute");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDb(): SqliteAdapter {
  if (instance) return instance;
  const file = join(dataDir(), "jroute.db");
  const isNewDb = !existsSync(file);
  const db = new Database(file) as unknown as SqliteAdapter;
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 2000");
  runMigrations(db, { isNewDb });
  instance = db;
  return instance;
}

export function resetDb(): void {
  if (!instance) return;
  instance.close();
  instance = null;
}
