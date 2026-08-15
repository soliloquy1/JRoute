// installer/src/installer/shortcuts.js
//
// Best-effort OS integration: auto-start at login, desktop shortcut, start-menu/dock entry.
// Implemented cross-platform where trivial; macOS relies on the .dmg placing the app in
// /Applications for the "Dock entry", so we only manage auto-start there.
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";

const AUTO_START_ID = "org.jroute.installer";

function startupFolder() {
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup"
    );
  }
  // Linux
  return join(homedir(), ".config", "autostart");
}

// ---- Auto-start at login ----

export function enableAutoStart(appPath) {
  if (process.platform === "darwin") return enableMacAutoStart(appPath);
  if (process.platform === "win32") return enableWinAutoStart(appPath);
  return enableLinuxAutoStart(appPath);
}

export function disableAutoStart() {
  if (process.platform === "darwin") {
    const p = join(homedir(), "Library", "LaunchAgents", `${AUTO_START_ID}.plist`);
    if (existsSync(p)) {
      try {
        spawn("launchctl", ["unload", p]);
      } catch {
        /* ignore */
      }
      rmSync(p, { force: true });
    }
    return;
  }
  if (process.platform === "win32") {
    const p = join(startupFolder(), `${AUTO_START_ID}.bat`);
    rmSync(p, { force: true });
    return;
  }
  const p = join(startupFolder(), `${AUTO_START_ID}.desktop`);
  rmSync(p, { force: true });
}

function enableMacAutoStart(appPath) {
  const dir = join(homedir(), "Library", "LaunchAgents");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${AUTO_START_ID}.plist`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AUTO_START_ID}</string>
  <key>ProgramArguments</key>
  <array><string>${appPath}</string></array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>`;
  writeFileSync(p, plist, "utf8");
  try {
    spawn("launchctl", ["load", p]);
  } catch {
    /* ignore */
  }
}

function enableWinAutoStart(appPath) {
  const dir = startupFolder();
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${AUTO_START_ID}.bat`);
  writeFileSync(p, `@echo off\r\nstart "" "${appPath}"\r\n`, "utf8");
}

function enableLinuxAutoStart(appPath) {
  const dir = startupFolder();
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${AUTO_START_ID}.desktop`);
  writeFileSync(
    p,
    `[Desktop Entry]\nType=Application\nName=JRoute\nExec="${appPath}"\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n`,
    "utf8"
  );
}

// ---- Desktop / Start-menu shortcuts ----

export function createShortcut({ appPath, label = "JRoute" }) {
  if (process.platform === "darwin") {
    // The .dmg places the app in /Applications; no extra shortcut needed.
    return;
  }
  if (process.platform === "win32") {
    const desktop = join(homedir(), "Desktop");
    mkdirSync(desktop, { recursive: true });
    writeFileSync(
      join(desktop, `${label}.bat`),
      `@echo off\r\nstart "" "${appPath}"\r\n`,
      "utf8"
    );
    return;
  }
  // Linux: desktop entry on the Desktop and in Applications.
  const desktop = join(homedir(), "Desktop");
  const applications = join(homedir(), ".local", "share", "applications");
  for (const dir of [desktop, applications]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${AUTO_START_ID}.desktop`),
      `[Desktop Entry]\nType=Application\nName=${label}\nExec="${appPath}"\nTerminal=false\nCategories=Utility;\n`,
      "utf8"
    );
  }
}
