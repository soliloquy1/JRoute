// installer/src/installer/shortcuts.js
//
// Best-effort OS integration: auto-start at login, desktop shortcut, start-menu/dock entry.
// Implemented cross-platform where trivial; macOS relies on the .dmg placing the app in
// /Applications for the "Dock entry", so we only manage auto-start there.
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { app } from "electron";

const AUTO_START_ID = "org.jroute.installer";
const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Packaged builds ship a real, unpacked icon.png at resourcesPath via electron-builder's
// extraResources (app.asar itself isn't readable as a plain file by outside processes
// like a Linux desktop-icon resolver). Dev/unpackaged runs fall back to the repo's own
// build/icon.png directly. Only meaningful on Linux (Windows points IconLocation at the
// .exe itself instead; macOS has no shortcut concept here at all — see createShortcut).
function resolveIconPath() {
  if (app.isPackaged) return join(process.resourcesPath, "icon.png");
  return join(__dirname, "..", "..", "build", "icon.png");
}

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
    // A real .lnk, not a .bat — a batch file has no icon slot at all, so the desktop
    // entry always showed Windows' generic console icon regardless of anything set here.
    // IconLocation points at the app's own .exe (index 0, its first embedded icon
    // resource — the one electron-builder already baked in from build/icon.png) rather
    // than a separate file, so it can't go stale if the icon changes later.
    const lnkPath = join(desktop, `${label}.lnk`);
    const psScript = [
      "$s = (New-Object -COM WScript.Shell).CreateShortcut($env:JR_LNK_PATH)",
      "$s.TargetPath = $env:JR_APP_PATH",
      "$s.IconLocation = $env:JR_APP_PATH + ',0'",
      "$s.Save()",
    ].join("; ");
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
      env: { ...process.env, JR_LNK_PATH: lnkPath, JR_APP_PATH: appPath },
    });
    return;
  }
  // Linux: desktop entry on the Desktop and in Applications, with a real Icon= path.
  const iconPath = resolveIconPath();
  const desktop = join(homedir(), "Desktop");
  const applications = join(homedir(), ".local", "share", "applications");
  for (const dir of [desktop, applications]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${AUTO_START_ID}.desktop`),
      `[Desktop Entry]\nType=Application\nName=${label}\nExec="${appPath}"\nIcon=${iconPath}\nTerminal=false\nCategories=Utility;\n`,
      "utf8"
    );
  }
}
