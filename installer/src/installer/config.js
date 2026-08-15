// installer/src/installer/config.js
//
// install.json is the single source of truth written once the first boot succeeds.
// It records everything the tray/manager needs to start/stop/update JRoute without
// re-running the wizard.
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const JRPCANONICAL_REPO = "soliloquy1/JRoute";
export const DEFAULT_PORT = 20128;
export const DEFAULT_CHANNEL = "release"; // "release" (latest tag) | "main"

export function appDataDir() {
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "JRoute");
    case "win32":
      return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "JRoute");
    default:
      return join(home, ".local", "share", "JRoute");
  }
}

export function defaultInstallDir() {
  return appDataDir();
}

export function defaultDataDir(installDir) {
  return join(installDir, "data");
}

export function configPath(installDir) {
  return join(installDir, "install.json");
}

export function loadConfig(installDir) {
  const p = configPath(installDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function saveConfig(installDir, config) {
  mkdirSync(installDir, { recursive: true });
  writeFileSync(configPath(installDir), JSON.stringify(config, null, 2), "utf8");
}

export function deleteConfig(installDir) {
  rmSync(configPath(installDir), { force: true });
}

// 32 random bytes, base64 — matches JRoute's recommended STORAGE_ENCRYPTION_KEY format.
export function generateEncryptionKey() {
  return randomBytes(32).toString("base64");
}
