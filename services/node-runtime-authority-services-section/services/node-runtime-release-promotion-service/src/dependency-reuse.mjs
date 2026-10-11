/**
 * Installed dependencies are a function of the lockfile, the manifests, the package manager's
 * configuration and the toolchain that installed them. A release names that function's input as its
 * install key, from git objects alone (no file is read), and a release whose key equals the running
 * release's carries the running release's node_modules instead of installing again.
 *
 * Carrying is a clone, never a share: every directory of the new tree is its own, so removing the
 * running release (retention) leaves the new one whole. A filesystem that reflinks clones file
 * contents; any other links each real file to the running release's inode, which is what the
 * installer's own store links do already. pnpm's trees are relative symlinks into node_modules/.pnpm,
 * so they stay valid at the new location. The clone is cut into jobs by directory and run in
 * parallel, because the work is the kernel's linking of ~100k inodes, not anything a job reads.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { workspaceManifestEntries } from "./workspace-lockfile.mjs";

const execute = promisify(execFile);
// What the package manager reads at the root, beyond what extractWorkspaceManifests needs.
const KEY_ROOT_FILES = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".pnpmfile.cjs", ".pnpmfile.mjs"]);
export const INSTALL_KEY_VERSION = 1;

/** The package manager a dependency command runs, when it is pnpm: its first word, else null. */
export function pnpmCommandOf(command) {
  const first = String(command ?? "").trim().split(/\s+/u)[0];
  return first && basename(first) === "pnpm" ? first : null;
}

/**
 * sha256 over the commit's lockfile, root pnpm files and every workspace package.json (the blob ids
 * git holds, by path, submodules included), and the versions of pnpm and node that install them.
 */
export function installKeyOf({ gitDir, commit, pnpmVersion, nodeVersion, platform = process.platform, arch = process.arch }) {
  if (!pnpmVersion || !nodeVersion) throw new Error("an install key names the pnpm and node versions");
  const entries = workspaceManifestEntries(gitDir, commit, { rootFiles: KEY_ROOT_FILES })
    .map(({ path, object }) => `${path}\0${object}`).sort();
  const hash = createHash("sha256");
  hash.update(`install-key\0${INSTALL_KEY_VERSION}\0pnpm ${pnpmVersion}\0node ${nodeVersion}\0${platform}-${arch}\0\0`);
  for (const entry of entries) hash.update(`${entry}\n`);
  return hash.digest("hex");
}

/** `reflink` when the filesystem clones file contents, else `hardlink`. */
export async function cloneMethodOf(directory) {
  const probe = join(directory, `.clone-probe-${process.pid}`);
  mkdirSync(probe, { recursive: true });
  try {
    writeFileSync(join(probe, "a"), "probe");
    await execute("cp", ["--reflink=always", join(probe, "a"), join(probe, "b")]);
    return "reflink";
  } catch { return "hardlink"; }
  finally { rmSync(probe, { recursive: true, force: true }); }
}

const cloneFlags = (method) => (method === "reflink" ? ["-a", "--reflink=always"] : ["-a", "-l"]);

// Every node_modules the tree holds, outermost only: where a project's installed dependencies live.
function nodeModulesOf(root) {
  const found = [];
  const visit = (relative) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name === "node_modules") found.push(path);
      else if (entry.name !== ".git") visit(path);
    }
  };
  visit("");
  return found;
}

/**
 * Carries `from`'s installed node_modules into `to` (a tree of the same projects): each node_modules
 * whose project directory `to` has and where `to` has none of its own. Returns what was done; throws on the
 * first failed job, leaving `to` partially seeded for the caller to clear.
 *
 * `projects` (a set of project directories, relative to the tree's root, "." the root itself) names the
 * projects the destination will have when `to` is not that tree yet but a side directory beside it, so the
 * carry can run while the tree is still being staged; `adoptDependencies` then moves the result in.
 */
export async function carryDependencies({ from, to, jobs = 16, batch = 40, method, projects }) {
  const clone = method ?? await cloneMethodOf(projects ? dirname(to) : to);
  const flags = cloneFlags(clone);
  const tasks = [];
  let directories = 0;
  for (const path of nodeModulesOf(from)) {
    if (projects) { if (!projects.has(dirname(path))) continue; mkdirSync(join(to, dirname(path)), { recursive: true }); }
    else if (!existsSync(join(to, dirname(path))) || existsSync(join(to, path))) continue;
    directories += 1;
    // The virtual store (node_modules/.pnpm) holds nearly every file: it is cut into batches of its
    // entries, the rest of the directory going in one job.
    const virtualStore = join(from, path, ".pnpm");
    const entries = existsSync(virtualStore) ? readdirSync(virtualStore) : [];
    if (entries.length < 2 * batch) { tasks.push(["-T", join(from, path), join(to, path)]); continue; }
    mkdirSync(join(to, path, ".pnpm"), { recursive: true });
    const rest = readdirSync(join(from, path)).filter((name) => name !== ".pnpm");
    if (rest.length > 0) tasks.push(["-t", join(to, path), ...rest.map((name) => join(from, path, name))]);
    for (let at = 0; at < entries.length; at += batch) tasks.push(["-t", join(to, path, ".pnpm"), ...entries.slice(at, at + batch).map((name) => join(virtualStore, name))]);
  }
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const [mode, ...rest] = tasks[next++]; await execute("cp", [...flags, mode, ...rest]); } };
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker));
  // The package store (node_modules/.pnpm/<package>) is content-addressed and never written in place, so
  // sharing its files is safe; the metadata pnpm rewrites on install (.package-map.json, .modules.yaml,
  // .pnpm/lock.yaml and the like, the regular files directly in a node_modules or its .pnpm) is not. Linked,
  // a later release's install wrote through into the running release's copies (2026-10-04, link count 3).
  let isolated = 0;
  for (const path of nodeModulesOf(to)) {
    for (const directory of [join(to, path), join(to, path, ".pnpm")]) {
      if (!existsSync(directory)) continue;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const file = join(directory, entry.name);
        copyFileSync(file, `${file}.isolating`);
        renameSync(`${file}.isolating`, file);
        isolated += 1;
      }
    }
  }
  return { method: clone, directories, jobs: tasks.length, isolated };
}

/**
 * Moves the node_modules `carryDependencies` made in the side directory `from` into the tree `to`, each
 * where `to` has its project directory and none of its own; a rename, so it costs nothing. Returns how
 * many it moved, and throws (leaving the rest in `from`) when one cannot be, for the caller to clear.
 */
export function adoptDependencies({ from, to }) {
  let adopted = 0;
  for (const path of nodeModulesOf(from)) {
    if (!existsSync(join(to, dirname(path))) || existsSync(join(to, path))) throw new Error(`cannot adopt ${path}: the release ${existsSync(join(to, path)) ? "has one" : "has no such project"}`);
    renameSync(join(from, path), join(to, path));
    adopted += 1;
  }
  return adopted;
}
