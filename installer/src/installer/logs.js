// installer/src/installer/logs.js
//
// A tiny ring-buffer logger. The wizard/manager stream both real-time (via IPC) and
// persist a copy to <DATA_DIR>/installer.log so "View Logs" can show history after a
// restart. Also tails JRoute's own <DATA_DIR>/debug.log when present.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const MAX_MEMORY_LINES = 2000;

export class LogBuffer {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.lines = [];
    this.file = dataDir ? join_log(dataDir) : null;
  }

  push(level, message) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${message}`;
    this.lines.push(line);
    if (this.lines.length > MAX_MEMORY_LINES) this.lines.shift();
    if (this.file) {
      try {
        appendFileSync(this.file, line + "\n", "utf8");
      } catch {
        /* non-fatal */
      }
    }
    return line;
  }

  info(m) {
    return this.push("info", m);
  }
  warn(m) {
    return this.push("warn", m);
  }
  error(m) {
    return this.push("error", m);
  }

  text() {
    return this.lines.join("\n");
  }

  // Combined view: our own log + the tail of JRoute's debug.log.
  fullText() {
    const parts = [this.text()];
    const debug = this.dataDir ? join_debug(this.dataDir) : null;
    if (debug && existsSync(debug)) {
      try {
        const content = readFileSync(debug, "utf8");
        const tail = content.split("\n").slice(-500).join("\n");
        parts.push("\n--- JRoute debug.log (tail) ---\n" + tail);
      } catch {
        /* ignore */
      }
    }
    return parts.join("\n");
  }
}

import { join } from "node:path";
function join_log(dataDir) {
  return join(dataDir, "installer.log");
}
function join_debug(dataDir) {
  return join(dataDir, "debug.log");
}
