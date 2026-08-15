// installer/src/installer/server.js
//
// Spawns the standalone server.cjs directly (NOT `jroute start`, which re-runs
// build-if-missing and is CLI-wrapped). The wrapper owns the child process so the tray
// can start/stop/restart cleanly. Reuses JRoute's /healthz poll contract (60s budget,
// 500ms interval, 3s per-attempt timeout).
import { join } from "node:path";
import { spawn } from "node:child_process";

const HEALTH_DEADLINE_MS = 60_000;
const HEALTH_INTERVAL_MS = 500;
const HEALTH_ATTEMPT_TIMEOUT_MS = 3_000;

export class JRouteServer {
  constructor({ nodePath, appDir, port, dataDir, encryptionKey, initialPassword, logBuffer }) {
    this.nodePath = nodePath;
    this.appDir = appDir;
    this.port = port;
    this.dataDir = dataDir;
    this.encryptionKey = encryptionKey;
    this.initialPassword = initialPassword;
    this.logBuffer = logBuffer;
    this.child = null;
  }

  get serverScript() {
    return join(this.appDir, ".build", "next", "standalone", "server.cjs");
  }

  start() {
    if (this.child) return this.child;
    const env = {
      ...process.env,
      PORT: String(this.port),
      DATA_DIR: this.dataDir,
      NODE_ENV: "production",
    };
    if (this.encryptionKey) env.STORAGE_ENCRYPTION_KEY = this.encryptionKey;
    if (this.initialPassword) env.INITIAL_PASSWORD = this.initialPassword;

    this.child = spawn(this.nodePath, [this.serverScript], {
      cwd: this.appDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (d) => this.logBuffer?.info(`[server] ${d.toString().trimEnd()}`));
    this.child.stderr.on("data", (d) => this.logBuffer?.info(`[server] ${d.toString().trimEnd()}`));
    this.child.on("exit", (code, signal) => {
      this.logBuffer?.warn(`Server exited (code=${code}, signal=${signal})`);
      this.child = null;
    });
    this.child.on("error", (err) => {
      this.logBuffer?.error(`Failed to start server: ${err.message}`);
      this.child = null;
    });
    return this.child;
  }

  stop() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    try {
      child.kill("SIGTERM");
      // Force-kill after a grace period.
      const id = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 5000);
      id.unref?.();
    } catch {
      /* ignore */
    }
  }

  get running() {
    return this.child !== null;
  }
}

export async function waitForHealth(port, deadlineMs = HEALTH_DEADLINE_MS) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const remaining = Math.max(deadline - Date.now(), 100);
      const res = await fetch(`http://localhost:${port}/healthz`, {
        signal: AbortSignal.timeout(Math.min(HEALTH_ATTEMPT_TIMEOUT_MS, remaining)),
      });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
  }
  return false;
}
