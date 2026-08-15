// installer/src/preload.js
//
// Exposes a minimal, safe API to the renderer via contextBridge. The renderer never
// gets direct Node access — only these wrapped IPC calls.
import { contextBridge, ipcRenderer } from "electron";

const api = {
  // wizard
  getOsDefaults: () => ipcRenderer.invoke("get-os-defaults"),
  checkPort: (port) => ipcRenderer.invoke("check-port", port),
  runInstall: (config) => ipcRenderer.invoke("run-install", config),
  onInstallLog: (cb) => ipcRenderer.on("install-log", (_e, arg) => cb(arg)),
  onInstallDone: (cb) => ipcRenderer.on("install-done", (_e, arg) => cb(arg)),
  resetInstall: () => ipcRenderer.invoke("reset-install"),

  // manager
  getStatus: () => ipcRenderer.invoke("manager-status"),
  start: () => ipcRenderer.invoke("manager-start"),
  stop: () => ipcRenderer.invoke("manager-stop"),
  restart: () => ipcRenderer.invoke("manager-restart"),
  update: () => ipcRenderer.invoke("manager-update"),
  onUpdateLog: (cb) => ipcRenderer.on("update-log", (_e, arg) => cb(arg)),
  onUpdateDone: (cb) => ipcRenderer.on("update-done", (_e, arg) => cb(arg)),
  openDashboard: () => ipcRenderer.invoke("open-dashboard"),
  getLogs: () => ipcRenderer.invoke("get-logs"),
};

contextBridge.exposeInMainWorld("jroute", api);
