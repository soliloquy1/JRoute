import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runMigrations } from "./migrationRunner.ts";
import { seedDefaultModels } from "./models.ts";
import { seedCatalogProviders } from "./providers.ts";
import type { SqliteAdapter } from "./adapters/types.ts";

const require = createRequire(import.meta.url);

// Type-only reference to the better-sqlite3 constructor (erased at runtime, so it does not
// pull the native module in at import time — that is what keeps the loader below lazy).
type BetterSqlite3Constructor = typeof import("better-sqlite3");

/**
 * better-sqlite3 is a required native dependency. It is loaded lazily (instead of a top-level
 * static import) so that a missing or unbuildable native binary produces a clear, actionable
 * error at startup rather than an opaque "Cannot find module" at import time. It is a real
 * `dependency` (not `optionalDependencies`) so `npm install` also fails loudly if no prebuilt
 * binary matches the installed Node version and native build tools are missing.
 */
function loadBetterSqlite3(): BetterSqlite3Constructor {
  try {
    return require("better-sqlite3") as BetterSqlite3Constructor;
  } catch (err) {
    throw new Error(
      "JRoute failed to load better-sqlite3, a required native dependency. This usually means no " +
        "prebuilt binary matched your Node.js version and no native build tools are installed. " +
        "Fix: use Node.js 22 LTS, or install build tools " +
        "(Windows: Visual Studio Build Tools + Python) and reinstall. " +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

let instance: SqliteAdapter | null = null;

export function dataDir(): string {
  const dir = process.env.DATA_DIR || join(homedir(), ".jroute");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDb(): SqliteAdapter {
  if (instance) return instance;
  const DatabaseCtor = loadBetterSqlite3();
  const file = join(dataDir(), "jroute.db");
  const isNewDb = !existsSync(file);
  const db = new DatabaseCtor(file) as unknown as SqliteAdapter;
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 2000");
  runMigrations(db, { isNewDb });
  instance = db;
  seedDefaultModels();
  seedCatalogProviders();
  return instance;
}

export function resetDb(): void {
  if (!instance) return;
  instance.close();
  instance = null;
}
