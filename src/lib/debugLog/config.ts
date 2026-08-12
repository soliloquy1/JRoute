// src/lib/debugLog/config.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db/bootstrap.ts";

export interface DebugLogConfig {
  enabled: boolean;
}

const DEFAULT_CONFIG: DebugLogConfig = { enabled: true };

export function getDebugLogConfigPath(): string {
  return join(dataDir(), "debug-log.json");
}

/**
 * Re-read from disk on every call — deliberately not cached. The whole point of a
 * JSON-file toggle is flipping it without restarting the server, and this file is tiny
 * (one boolean), so a sync read per check is cheap enough not to matter.
 *
 * On first read (no file yet), writes the default file so the toggle is visible and
 * editable immediately — matches "enabled by default for now" from the operator's own
 * request, and gives them a real file to flip off later without hunting for the schema.
 */
export function readDebugLogConfig(): DebugLogConfig {
  const path = getDebugLogConfigPath();
  if (!existsSync(path)) {
    try {
      writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
    } catch {
      // Best-effort — if we can't write the default file, still return the default.
    }
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<DebugLogConfig>;
    // A malformed or half-written config must never crash the app, and must never
    // silently turn debugging off either — fail open to enabled, same as a missing file.
    return { enabled: parsed.enabled !== false };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function isDebugLogEnabled(): boolean {
  return readDebugLogConfig().enabled;
}
