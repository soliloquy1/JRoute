// installer/src/installer/source.js
//
// Fetches JRoute source into <installDir>/app. Prefers `git clone` when git is on PATH,
// otherwise downloads a GitHub source tarball of the chosen ref (no git dependency).
import { existsSync, mkdirSync, rmSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import * as tar from "tar";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { JRPCANONICAL_REPO } from "./config.js";

function gitOnPath() {
  return new Promise((resolve) => {
    const p = spawn(process.platform === "win32" ? "where" : "which", ["git"]);
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

function run(cmd, args, opts, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      onLog?.("info", d.toString().trimEnd());
    });
    child.stderr.on("data", (d) => {
      out += d.toString();
      onLog?.("info", d.toString().trimEnd());
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`"${cmd} ${args.join(" ")}" exited ${code}: ${out.trim()}`))
    );
  });
}

export async function hasSource(appDir) {
  return existsSync(join(appDir, "package.json"));
}

// Resolves a ref for the "latest release" channel via the GitHub API.
export async function resolveReleaseRef(repo = JRPCANONICAL_REPO) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "jroute-installer" },
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.tag_name) return json.tag_name;
    }
  } catch {
    /* fall through */
  }
  return "main";
}

async function downloadTarball(repo, ref, destFile, onLog) {
  const candidates = [
    `https://github.com/${repo}/archive/${ref}.tar.gz`,
    `https://github.com/${repo}/archive/refs/heads/${ref}.tar.gz`,
    `https://github.com/${repo}/archive/refs/tags/${ref}.tar.gz`,
  ];
  for (const url of candidates) {
    try {
      onLog("info", `Downloading source: ${url}`);
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        onLog("warn", `  ${url} -> ${res.status}, trying next`);
        continue;
      }
      const fileStream = createWriteStream(destFile);
      await pipeline(Readable.fromWeb(res.body), fileStream);
      return true;
    } catch (e) {
      onLog("warn", `  ${url} failed: ${e.message}`);
    }
  }
  throw new Error(`Could not download source for ref "${ref}" from ${repo}`);
}

// Extracts a GitHub tarball, flattening the single top-level folder it always contains.
async function extractSource(tarball, appDir, onLog) {
  mkdirSync(appDir, { recursive: true });
  const tmp = join(appDir, "..", `_src_extract_${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    await tar.x({ file: tarball, cwd: tmp });
    const entries = readdirSync(tmp).filter((e) => !e.startsWith("."));
    const top = entries.length === 1 ? join(tmp, entries[0]) : tmp;
    // Move contents of `top` into appDir.
    for (const e of readdirSync(top)) {
      renameSync(join(top, e), join(appDir, e));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(tarball, { force: true });
  }
}

export async function fetchSource({ installDir, repo = JRPCANONICAL_REPO, ref, onLog, force = false }) {
  const appDir = join(installDir, "app");
  if (!force && (await hasSource(appDir))) {
    onLog("info", `JRoute source already present at ${appDir}`);
    return appDir;
  }
  mkdirSync(appDir, { recursive: true });

  if (await gitOnPath()) {
    onLog("info", `Cloning ${repo}#${ref} into ${appDir}`);
    try {
      await run("git", ["clone", "--depth", "1", "--branch", ref, `https://github.com/${repo}.git`, appDir], {}, onLog);
      return appDir;
    } catch (e) {
      onLog("warn", `git clone failed (${e.message}); falling back to tarball.`);
      // A failed clone can leave a partial <appDir> that would block the tarball
      // extraction (rename conflicts) and any later re-clone. Wipe it first.
      rmSync(appDir, { recursive: true, force: true });
      mkdirSync(appDir, { recursive: true });
    }
  }

  const tarball = join(installDir, "runtime", `_src_${ref}.tar.gz`);
  mkdirSync(join(installDir, "runtime"), { recursive: true });
  await downloadTarball(repo, ref, tarball, onLog);
  await extractSource(tarball, appDir, onLog);
  onLog("info", `Source extracted to ${appDir}`);
  return appDir;
}

// Re-fetches for "Update JRoute". git pull if cloned, else wipe + redownload.
export async function updateSource({ installDir, repo = JRPCANONICAL_REPO, ref, onLog }) {
  const appDir = join(installDir, "app");
  const isGit = existsSync(join(appDir, ".git"));
  if (isGit) {
    onLog("info", `Updating via git pull (${ref})`);
    await run("git", ["fetch", "--depth", "1", "origin", ref], { cwd: appDir }, onLog);
    await run("git", ["reset", "--hard", `FETCH_HEAD`], { cwd: appDir }, onLog);
    return appDir;
  }
  // Non-git: remove app contents and re-fetch.
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });
  await fetchSource({ installDir, repo, ref, onLog, force: true });
  return appDir;
}
