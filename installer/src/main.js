// installer/src/main.js
//
// Electron entry point. Owns: the wizard/manager window, the system tray, and the
// process manager (a single JRouteManager instance for the installed server). JRoute
// itself runs as an external child process under the downloaded Node — never inside
// Electron — so better-sqlite3's native ABI never touches Electron's runtime.
import { app, BrowserWindow, Tray, Menu, ipcMain, shell } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  appDataDir,
  defaultInstallDir,
  defaultDataDir,
  loadConfig,
  deleteConfig,
  DEFAULT_PORT,
} from "./installer/config.js";
import { createManager } from "./installer/pipeline.js";
import { findFreePort } from "./installer/port.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isDev = !app.isPackaged;

let mainWindow = null;
let tray = null;
let manager = null;
let installDir = defaultInstallDir();

// The manager (and its JRouteServer child) emits lifecycle logs through a single
// callback. During the install wizard we route them to "install-log"; during an
// in-app update we flip the target to "update-log" so the renderer's listeners
// (registered for those distinct channels) receive the right stream.
let managerLogSender = (level, msg) => send("install-log", { level, msg });
function setManagerLogTarget(channel) {
  managerLogSender = (level, msg) => send(channel, { level, msg });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 680,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: "#0e1117",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(join(__dirname, "ui", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// Forwards manager update/build logs to the renderer's "update-log" listener.
function managerOnLog(level, msg) {
  send("update-log", { level, msg });
}

// Routes the user to the wizard or the manager based on whether install.json exists.
function initialView() {
  const cfg = loadConfig(installDir);
  return cfg ? "manager" : "wizard";
}

// ---- IPC handlers ----

function registerIpc() {
  ipcMain.handle("get-os-defaults", () => {
    const cfg = loadConfig(installDir);
    return {
      installDir: installDir,
      defaultInstallDir: defaultInstallDir(),
      defaultDataDir: defaultDataDir(installDir),
      appDataDir: appDataDir(),
      platform: process.platform,
      defaultPort: DEFAULT_PORT,
      hasConfig: !!cfg,
      config: cfg,
      initialView: initialView(),
    };
  });

  ipcMain.handle("check-port", async (_e, requested) => {
    const port = await findFreePort(Number(requested) || DEFAULT_PORT);
    return { requested: Number(requested) || DEFAULT_PORT, port };
  });

  ipcMain.handle("run-install", async (_e, wizardConfig) => {
    // Allow overriding install dir from the wizard.
    if (wizardConfig.installDir) installDir = wizardConfig.installDir;
    try {
      const { runInstall } = await import("./installer/pipeline.js");
      // runInstall boots through the manager and RETURNS it, so the tray/stop/quit
      // paths control the actual running server process.
      manager = await runInstall(wizardConfig, (level, msg) => {
        managerLogSender(level, msg);
      });
      send("install-done", { ok: true, port: manager.config.port });
    } catch (err) {
      send("install-log", { level: "error", msg: String(err.message || err) });
      send("install-done", { ok: false, error: String(err.message || err) });
    }
    return true;
  });

  ipcMain.handle("manager-status", () => buildStatus());

  ipcMain.handle("manager-start", async () => {
    if (!manager) return buildStatus();
    try {
      const ok = await manager.start();
      refreshTray();
      return { ...buildStatus(), started: ok };
    } catch (err) {
      const error = String(err.message || err);
      return { ...buildStatus(), started: false, error };
    }
  });

  ipcMain.handle("manager-stop", () => {
    manager?.stop();
    refreshTray();
    return buildStatus();
  });

  ipcMain.handle("manager-restart", async () => {
    manager?.stop();
    await new Promise((r) => setTimeout(r, 500));
    if (!manager) return buildStatus();
    try {
      const ok = await manager.start();
      refreshTray();
      return { ...buildStatus(), started: ok };
    } catch (err) {
      const error = String(err.message || err);
      return { ...buildStatus(), started: false, error };
    }
  });

  ipcMain.handle("manager-update", async () => {
    if (!manager) return buildStatus();
    // Route the manager's lifecycle logs to the renderer's "update-log" listener
    // (it was set to "install-log" during the install wizard).
    setManagerLogTarget("update-log");
    try {
      const ok = await manager.update();
      refreshTray();
      send("update-done", { ok });
    } catch (err) {
      send("update-log", { level: "error", msg: String(err.message || err) });
      send("update-done", { ok: false, error: String(err.message || err) });
    }
    return buildStatus();
  });

  ipcMain.handle("open-dashboard", () => {
    if (manager) shell.openExternal(manager.url());
    return true;
  });

  ipcMain.handle("get-logs", () => (manager ? manager.logs() : ""));

  ipcMain.handle("reset-install", () => {
    manager?.stop();
    manager = null;
    deleteConfig(installDir);
    refreshTray();
    return true;
  });
}

function buildStatus() {
  const cfg = manager?.config || loadConfig(installDir);
  return {
    running: manager?.running ?? false,
    port: cfg?.port ?? DEFAULT_PORT,
    url: cfg ? `http://localhost:${cfg.port}/` : null,
    ref: cfg?.ref,
    channel: cfg?.channel,
    installedAt: cfg?.installedAt,
    hasManager: !!manager,
  };
}

// ---- Tray ----

function buildTrayMenu() {
  const items = [
    { label: "Open Dashboard", click: () => manager?.running && shell.openExternal(manager.url()) },
    {
      label: manager?.running ? "Stop JRoute" : "Start JRoute",
      click: async () => {
        if (manager?.running) manager.stop();
        else await manager?.start();
        if (tray) tray.setContextMenu(buildTrayMenu());
      },
    },
    { label: "View Logs", click: () => mainWindow && mainWindow.show() },
    { type: "separator" },
    { label: "Quit JRoute Installer", click: () => app.quit() },
  ];
  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  // A tiny embedded icon would go here; fall back to a generic tray if missing.
  const iconPath = join(__dirname, "ui", "tray.png");
  tray = new Tray(iconPath);
  tray.setToolTip("JRoute");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => mainWindow && mainWindow.show());
}

// ---- lifecycle ----

app.whenReady().then(() => {
  const cfg = loadConfig(installDir);
  if (cfg) manager = createManager(cfg, managerOnLog);
  registerIpc();
  createWindow();
  if (existsSync(join(__dirname, "ui", "tray.png"))) createTray();
  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    else if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Intentionally not calling app.quit() keeps the app alive in the tray.
  // This is a background manager, not a document-style app.
});

app.on("before-quit", () => {
  manager?.stop();
});
