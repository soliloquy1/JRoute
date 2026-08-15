// installer/src/installer/pipeline.js
//
// Orchestrates the full install pipeline and exposes a Manager for the tray/UI to
// start/stop/update the already-installed JRoute.
import { mkdirSync } from "node:fs";
import {
  DEFAULT_PORT,
  DEFAULT_CHANNEL,
  JRPCANONICAL_REPO,
  generateEncryptionKey,
  saveConfig,
} from "./config.js";
import { ensureNode } from "./nodeRuntime.js";
import { fetchSource, resolveReleaseRef, updateSource } from "./source.js";
import { buildJRoute } from "./build.js";
import { JRouteServer, waitForHealth } from "./server.js";
import { findFreePort } from "./port.js";
import { LogBuffer } from "./logs.js";
import { enableAutoStart, createShortcut } from "./shortcuts.js";

function makeLogger(logBuffer, onLog) {
  return (level, msg) => {
    if (level === "error") logBuffer.error(msg);
    else if (level === "warn") logBuffer.warn(msg);
    else logBuffer.info(msg);
    onLog?.(level, msg);
  };
}

export async function runInstall(opts, onLog = () => {}) {
  const {
    installDir,
    dataDir,
    port = DEFAULT_PORT,
    channel = DEFAULT_CHANNEL,
    explicitRef,
    repo = JRPCANONICAL_REPO,
    adminPassword,
    autoStart = false,
    shortcuts = false,
  } = opts;

  const log = new LogBuffer(dataDir);
  const logF = makeLogger(log, onLog);

  mkdirSync(installDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  // 1. Node 22 runtime (ABI-locked to better-sqlite3).
  logF("info", "Step 1/5 — Preparing Node.js runtime…");
  const { nodePath, npmPath, version: nodeVersion } = await ensureNode({
    installDir,
    platform: process.platform,
    arch: process.arch,
    onLog: logF,
  });

  // 2. Resolve the source ref for this channel.
  let ref = explicitRef || (channel === "main" ? "main" : await resolveReleaseRef(repo));
  logF("info", `Step 2/5 — Channel "${channel}" → ref "${ref}"`);

  // 3. Fetch JRoute source.
  logF("info", "Step 3/5 — Fetching JRoute source…");
  const appDir = await fetchSource({ installDir, repo, ref, onLog: logF });

  // 4. Install deps + build standalone server.
  logF("info", "Step 4/5 — Installing dependencies and building…");
  await buildJRoute({ nodePath, npmPath, appDir, onLog: logF });

  // 5. Pick a free port, then boot THROUGH the manager so it OWNS the running child
  //    process. (If we started a throwaway JRouteServer here, the tray/stop/quit paths
  //    could never control it, and a later manager.start() would spawn a 2nd instance
  //    on the same port.)
  logF("info", "Step 5/5 — Starting JRoute…");
  const actualPort = await findFreePort(Number(port));
  if (actualPort !== Number(port)) {
    logF("warn", `Port ${port} was in use; using ${actualPort} instead.`);
  }
  const encryptionKey = generateEncryptionKey();

  const config = {
    version: "0.2.0-beta",
    installDir,
    dataDir,
    appDir,
    port: actualPort,
    nodePath,
    npmPath,
    nodeVersion,
    ref,
    channel,
    repo,
    encryptionKey,
    installedAt: new Date().toISOString(),
  };

  const manager = createManager(config, onLog);
  const started = await manager.start({ initialPassword: adminPassword });
  if (!started) {
    manager.stop();
    throw new Error(
      "JRoute did not become healthy within 60s. Open the logs to see the server output."
    );
  }

  // Persist ONLY after a successful first boot — never a half-built server.
  saveConfig(installDir, config);

  try {
    if (autoStart) enableAutoStart(process.execPath);
    if (shortcuts) createShortcut({ appPath: process.execPath });
  } catch (e) {
    logF("warn", `OS integration skipped: ${e.message}`);
  }

  logF("info", `JRoute is running at http://localhost:${actualPort}/`);
  return manager;
}

// Manager wraps a saved install.json so the tray/UI can control the running server.
export function createManager(savedConfig, onLog = () => {}) {
  const log = new LogBuffer(savedConfig.dataDir);
  const logF = makeLogger(log, onLog);
  let server = null;

  return {
    config: savedConfig,

    async start(opts = {}) {
      if (server?.running) return true;
      server = new JRouteServer({
        nodePath: savedConfig.nodePath,
        appDir: savedConfig.appDir,
        port: savedConfig.port,
        dataDir: savedConfig.dataDir,
        encryptionKey: savedConfig.encryptionKey,
        initialPassword: opts.initialPassword,
        logBuffer: log,
      });
      server.start();
      const ok = await waitForHealth(savedConfig.port);
      if (!ok) {
        server.stop();
        server = null;
        return false;
      }
      return true;
    },

    stop() {
      server?.stop();
      server = null;
    },

    get running() {
      return !!server?.running;
    },

    url() {
      return `http://localhost:${savedConfig.port}/`;
    },

    async update() {
      this.stop();
      let ref = savedConfig.ref;
      if (savedConfig.channel === "release") {
        ref = await resolveReleaseRef(savedConfig.repo);
        savedConfig.ref = ref;
        saveConfig(savedConfig.installDir, savedConfig);
      }
      logF("info", `Updating JRoute to ref "${ref}"…`);
      await updateSource({
        installDir: savedConfig.installDir,
        repo: savedConfig.repo,
        ref,
        onLog: logF,
      });
      await buildJRoute({
        nodePath: savedConfig.nodePath,
        npmPath: savedConfig.npmPath,
        appDir: savedConfig.appDir,
        onLog: logF,
      });
      return this.start();
    },

    logs() {
      return log.fullText();
    },
  };
}
