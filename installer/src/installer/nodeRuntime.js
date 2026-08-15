// installer/src/installer/nodeRuntime.js
//
// Downloads one pinned Node 22 LTS into <installDir>/runtime/node and uses it for every
// subsequent command (npm ci, next build, server.cjs). This keeps better-sqlite3 on a
// single, stable ABI — the whole reason we don't rely on the user's system Node.
import { createWriteStream } from "node:fs";
import { mkdirSync, existsSync, rmSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import * as tar from "tar";

const NODE_DIST_INDEX = "https://nodejs.org/dist/index.json";

// Engines constraint from JRoute's package.json: ">=22.22.2 <23 || >=24 <27".
// We deliberately stay on the 22 LTS line (best better-sqlite3 prebuild coverage).
const ENGINE_MIN = [22, 22, 2];

function gteMin(v) {
  const cur = v.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if (cur[i] > ENGINE_MIN[i]) return true;
    if (cur[i] < ENGINE_MIN[i]) return false;
  }
  return true;
}

// Picks the newest 22.x release satisfying the engine floor. Cached for the session.
let cachedVersion = null;
export async function resolveNodeVersion() {
  if (cachedVersion) return cachedVersion;
  const res = await fetch(NODE_DIST_INDEX);
  if (!res.ok) throw new Error(`Failed to fetch Node version index (${res.status})`);
  const list = await res.json();
  const candidates = list
    .map((e) => e.version.replace(/^v/, ""))
    .filter((v) => /^22\./.test(v) && gteMin(v))
    .sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
      return 0;
    });
  if (candidates.length === 0) {
    throw new Error("No Node 22.x release satisfies JRoute's engine requirement.");
  }
  cachedVersion = candidates[0];
  return cachedVersion;
}

function platformKey(platform, arch) {
  // Returns the Node dist filename fragment, e.g. "darwin-arm64", "win-x64", "linux-x64".
  const os = platform === "win32" ? "win" : platform === "darwin" ? "darwin" : "linux";
  const a = arch === "arm64" ? "arm64" : "x64";
  return { os, arch: a };
}

function nodeArchiveUrl(version, os, arch) {
  const base = `https://nodejs.org/dist/v${version}/node-v${version}-${os}-${arch}`;
  return os === "win" ? `${base}.zip` : `${base}.tar.gz`;
}

// Locates node/npm binaries inside an extracted Node tree, cross-platform.
export function locateNode(rootDir) {
  if (process.platform === "win32") {
    const node = join(rootDir, "node.exe");
    const npm = join(rootDir, "npm.cmd");
    if (!existsSync(node)) throw new Error(`Node binary not found at ${node}`);
    return { nodePath: node, npmPath: npm };
  }
  // macOS / Linux: node sits in <root>/bin/node
  const node = join(rootDir, "bin", "node");
  const npm = join(rootDir, "bin", "npm");
  if (!existsSync(node)) throw new Error(`Node binary not found at ${node}`);
  return { nodePath: node, npmPath: npm };
}

async function download(url, destFile, onLog) {
  onLog("info", `Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0;
  const fileStream = createWriteStream(destFile);
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    if (total > 0 && received % (1024 * 1024 * 5) < chunk.length) {
      onLog("info", `  ${((received / total) * 100).toFixed(0)}%`);
    }
  });
  await pipeline(body, fileStream);
}

// Extracts a Node archive and flattens its single top-level folder into destDir, so
// BOTH the .tar.gz (macOS/Linux) and .zip (Windows) layouts land node at the same
// relative path that locateNode() expects. We extract into a scratch dir first, then
// move the contents of the one top folder up into destDir.
async function extract(file, destDir, onLog) {
  onLog("info", `Extracting ${file}`);
  const tmp = join(destDir, "..", `_node_extract_${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    if (file.endsWith(".zip")) {
      // Windows node ships as .zip. Windows 10+ has tar.exe that extracts zip natively.
      const { spawn } = await import("node:child_process");
      await new Promise((resolve, reject) => {
        const p = spawn("tar", ["-xf", file, "-C", tmp], { stdio: "inherit" });
        p.on("error", reject);
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tar exit ${code}`))));
      });
    } else {
      await tar.x({ file, cwd: tmp });
    }
    const entries = readdirSync(tmp).filter((e) => !e.startsWith("."));
    const top = entries.length === 1 ? join(tmp, entries[0]) : tmp;
    for (const e of readdirSync(top)) {
      renameSync(join(top, e), join(destDir, e));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Downloads (if needed) and returns { nodePath, npmPath, version }.
export async function ensureNode({ installDir, platform, arch, onLog, force = false }) {
  const version = await resolveNodeVersion();
  const { os, arch: a } = platformKey(platform, arch);
  const runtimeDir = join(installDir, "runtime", "node");
  const versionDir = join(runtimeDir, `v${version}-${os}-${a}`);
  const { nodePath } = locateNodeSafe(versionDir);
  if (!force && nodePath && existsSync(nodePath)) {
    onLog("info", `Node v${version} already present.`);
    return { ...locateNode(versionDir), version };
  }
  mkdirSync(versionDir, { recursive: true });
  // Start from a clean target so a previously interrupted extraction can't leave
  // files that conflict with the flatten step below.
  rmSync(versionDir, { recursive: true, force: true });
  mkdirSync(versionDir, { recursive: true });
  const url = nodeArchiveUrl(version, os, a);
  const tmpFile = join(runtimeDir, `node-v${version}-${os}-${a}${os === "win" ? ".zip" : ".tar.gz"}`);
  try {
    await download(url, tmpFile, onLog);
    await extract(tmpFile, versionDir, onLog);
  } finally {
    try {
      rmSync(tmpFile, { force: true });
    } catch {
      /* ignore */
    }
  }
  const located = locateNode(versionDir);
  if (!existsSync(located.nodePath)) {
    throw new Error(`Node did not extract correctly to ${located.nodePath}`);
  }
  onLog("info", `Node v${version} ready at ${located.nodePath}`);
  return { ...located, version };
}

function locateNodeSafe(rootDir) {
  try {
    return locateNode(rootDir);
  } catch {
    return { nodePath: null, npmPath: null };
  }
}
