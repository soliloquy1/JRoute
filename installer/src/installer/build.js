// installer/src/installer/build.js
//
// Installs JRoute deps with the downloaded Node's npm, then runs `jroute build`
// (next build + ensureStandaloneAssets). Surfaces real errors instead of failing silent.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

// Mirrors bin/jroute.js: build is `node <nextBin> build` with cwd=appDir, which copies
// static/public into the standalone bundle via ensureStandaloneAssets().
export async function buildJRoute({ nodePath, npmPath, appDir, onLog }) {
  if (!existsSync(join(appDir, "package.json"))) {
    throw new Error("JRoute source is missing package.json — source fetch likely failed.");
  }

  onLog("info", "Installing JRoute dependencies (npm ci)…");
  onLog("info", "This can take several minutes on first install.");
  await runProcess(npmPath, ["ci"], { cwd: appDir }, onLog);

  onLog("info", "Building JRoute standalone server (next build)…");
  const jrouteCli = join(appDir, "bin", "jroute.js");
  await runProcess(nodePath, [jrouteCli, "build"], { cwd: appDir }, onLog);

  const server = join(appDir, ".build", "next", "standalone", "server.cjs");
  if (!existsSync(server)) {
    throw new Error("Build completed but standalone server.cjs was not produced.");
  }
  onLog("info", "Build complete.");
}

function runProcess(cmd, args, opts, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      ...opts,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(opts.env || {}) },
    });
    child.stdout.on("data", (d) => onLog?.("info", d.toString().trimEnd()));
    child.stderr.on("data", (d) => onLog?.("info", d.toString().trimEnd()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (exit ${code}): ${cmd} ${args.join(" ")}`));
    });
  });
}
