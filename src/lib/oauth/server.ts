// src/lib/oauth/server.ts
import http from "http";
import { URL } from "url";

/**
 * Start a local loopback HTTP server to receive an OAuth PKCE redirect. Used only by
 * xai-oauth (the sole expressible provider whose flow needs an automated callback —
 * claude/cline redirect to a fixed non-loopback URL and rely on the user pasting the
 * resulting code back instead).
 */
export function startLocalServer(
  onCallback: (params: Record<string, string>) => void,
  fixedPort: number | null = null
): Promise<{ server: http.Server; port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://localhost");

      if (url.pathname === "/callback" || url.pathname === "/auth/callback") {
        const params = Object.fromEntries(url.searchParams);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authentication Successful</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5;">
  <div style="text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);">
    <div style="color:#22c55e;font-size:3rem;">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p>You can close this tab and return to JRoute.</p>
  </div>
</body>
</html>`);
        onCallback(params);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    const portToUse = fixedPort || 0;
    server.listen(portToUse, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, close: () => server.close() });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && fixedPort) {
        reject(
          new Error(`Port ${fixedPort} is already in use. Close other apps using that port.`)
        );
      } else {
        reject(err);
      }
    });
  });
}
