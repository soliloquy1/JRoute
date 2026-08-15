// installer/src/installer/port.js
//
// Replicates JRoute's own port-conflict handling: probe the requested port and walk
// upward to the next free one, returning the actual port the server should bind to.
import net from "node:net";

export function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => {
      srv.close(() => resolve(true));
    });
  });
}

// Returns the first free port >= startPort (capped so we don't loop forever).
export async function findFreePort(startPort, maxTries = 100) {
  for (let p = startPort; p < startPort + maxTries; p++) {
    if (await isPortFree(p)) return p;
  }
  return startPort; // give up; let the server fail with a clear error
}
