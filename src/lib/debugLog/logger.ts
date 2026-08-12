// src/lib/debugLog/logger.ts
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db/bootstrap.ts";
import { redactLogArgs } from "../../shared/utils/logRedaction.ts";
import { ensureLogDir, rotateIfNeeded, cleanupOverflowLogs } from "../logRotation.ts";
import { isDebugLogEnabled } from "./config.ts";

// Dedicated to this log only — deliberately not the app's general 50MB/20-file defaults
// (src/lib/logEnv.ts), since "everything down to miniscule detail" grows much faster than
// the app's normal structured logs.
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_ROTATED_FILES = 5;

export function debugLogFilePath(): string {
  return join(dataDir(), "debug.log");
}

// Deliberately NOT pino here (unlike src/shared/utils/logger.ts): pino's async file
// destination (pino.destination/pino.transport) registers a process-exit auto-flush hook
// that crashes (`sonic boom is not ready yet`) if the destination directory disappears
// mid-run — real in tests (each test's tmpdir is removed in `after()`), and not
// impossible in production either (an operator could delete DATA_DIR while the server
// runs). A plain synchronous `appendFileSync` per line has no background worker, no
// exit hook, and no dangling file-handle state to crash on — any write failure surfaces
// immediately, inline, inside this function's own try/catch.
let rotationCheckedForPath: string | null = null;

function ensureRotation(path: string): void {
  if (rotationCheckedForPath === path) return;
  ensureLogDir(path);
  rotateIfNeeded(path, MAX_FILE_SIZE);
  cleanupOverflowLogs(path, MAX_ROTATED_FILES);
  rotationCheckedForPath = path;
}

function writeLine(level: "info" | "error", category: string, data: Record<string, unknown>): void {
  try {
    const path = debugLogFilePath();
    ensureRotation(path);

    const [redacted] = redactLogArgs([{ category, ...data }]) as [Record<string, unknown>];
    const line = {
      time: new Date().toISOString(),
      level,
      service: "jroute-debug",
      ...redacted,
    };
    appendFileSync(path, `${JSON.stringify(line)}\n`);
  } catch (err) {
    try {
      process.stderr.write(
        `[debugLog] write failed, dropping log line: ${(err as Error)?.message || err}\n`
      );
    } catch {
      // Never let a logging failure crash the process.
    }
  }
}

/**
 * Structured, JSON-lines debug logging for the full request pipeline. Every call site
 * should log real shapes — actual bodies, actual upstream responses, actual errors with
 * stack traces — not summaries; that fidelity is the entire point of a log meant to be
 * hand-fed to an LLM agent debugging a specific request. Credential VALUES are still
 * redacted (see logRedaction.ts) — debugging a routing/conversion bug essentially never
 * needs the raw secret, and this log is designed to leave the machine.
 *
 * No-ops — and does zero file I/O — when disabled via <DATA_DIR>/debug-log.json. Never
 * throws: a logging failure must never break the request it's trying to help debug.
 */
export function debugLog(category: string, data: Record<string, unknown> = {}): void {
  if (!isDebugLogEnabled()) return;
  writeLine("info", category, data);
}

export function debugLogError(
  category: string,
  err: unknown,
  data: Record<string, unknown> = {}
): void {
  if (!isDebugLogEnabled()) return;
  const errShape =
    err instanceof Error
      ? { errName: err.name, errMessage: err.message, errStack: err.stack }
      : { err };
  writeLine("error", category, { ...data, ...errShape });
}
