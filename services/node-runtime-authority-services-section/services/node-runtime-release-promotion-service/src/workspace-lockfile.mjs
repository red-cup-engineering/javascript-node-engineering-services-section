/**
 * A workspace's lockfile is derived source: the package manager's resolution of the commit's
 * workspace manifests, starting from the resolutions the commit's lockfile already holds. Nobody
 * authors it. Integration derives it for every commit it admits, from that commit's manifests --
 * the root pnpm files and every package.json, including those of the submodules at the commits
 * their gitlinks record -- so a writer whose checkout lacks a submodule, or whose hand merged two
 * lockfiles, cannot put a lockfile on main that the release install refuses.
 *
 * Both readings work on the commit's objects, never a working tree: the manifests are written to a
 * scratch directory, and the package manager reads only them and the lockfile there.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const LOCKFILE = "pnpm-lock.yaml";
const ROOT_FILES = new Set(["package.json", LOCKFILE, "pnpm-workspace.yaml", ".npmrc"]);

const gitSync = (gitDir, ...args) => execFileSync("git", [`--git-dir=${gitDir}`, ...args], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });

/** The commit's submodule names by path, from its .gitmodules (a module's gitdir is named for it). */
function submoduleNames(gitDir, commit) {
  let config;
  try { config = gitSync(gitDir, "show", `${commit}:.gitmodules`).toString(); }
  catch { return new Map(); }
  const names = new Map();
  let name;
  for (const line of config.split("\n")) {
    const section = line.match(/^\s*\[submodule\s+"(.+)"\]/u);
    if (section) name = section[1];
    const path = line.match(/^\s*path\s*=\s*(.+?)\s*$/u);
    if (path && name) names.set(path[1], name);
  }
  return names;
}

/**
 * The commit's workspace manifests (and its submodules', recursively) as `{ gitDir, path, object }`:
 * every package.json, and at the root the files the package manager reads. Only trees are walked,
 * so naming them reads no file; a submodule's missing objects are fetched.
 */
export function workspaceManifestEntries(gitDir, commit, { rootFiles = ROOT_FILES, prefix = "" } = {}) {
  const names = submoduleNames(gitDir, commit);
  const found = [];
  for (const entry of gitSync(gitDir, "ls-tree", "-r", "-z", commit).toString().split("\0").filter(Boolean)) {
    const [meta, path] = entry.split("\t");
    const [, type, object] = meta.split(" ");
    if (type === "commit") {
      const moduleDir = join(gitDir, "modules", names.get(path) ?? path);
      try { gitSync(moduleDir, "cat-file", "-e", `${object}^{commit}`); }
      catch { gitSync(moduleDir, "fetch", "--quiet", "origin", object); }
      found.push(...workspaceManifestEntries(moduleDir, object, { rootFiles, prefix: `${prefix}${path}/` }));
    } else if (type === "blob" && (path === "package.json" || path.endsWith("/package.json") || (!prefix && rootFiles.has(path)))) {
      // A submodule's own package.json sits at its root, where its path has no directory.
      found.push({ gitDir, path: `${prefix}${path}`, object });
    }
  }
  return found;
}

/** Writes the commit's workspace manifests (and its submodules', recursively) under `out`. */
export function extractWorkspaceManifests(gitDir, commit, out) {
  const byRepository = new Map();
  for (const entry of workspaceManifestEntries(gitDir, commit)) byRepository.set(entry.gitDir, [...(byRepository.get(entry.gitDir) ?? []), entry]);
  for (const [repository, blobs] of byRepository) {
    // One cat-file for the lot: each record is "<oid> blob <size>\n<bytes>\n".
    const batch = execFileSync("git", [`--git-dir=${repository}`, "cat-file", "--batch"], {
      input: blobs.map(({ object }) => object).join("\n") + "\n", maxBuffer: 1 << 28,
    });
    let offset = 0;
    for (const { path } of blobs) {
      const target = join(out, path);
      const headerEnd = batch.indexOf(10, offset);
      const size = Number(batch.subarray(offset, headerEnd).toString().split(" ")[2]);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, batch.subarray(headerEnd + 1, headerEnd + 1 + size));
      offset = headerEnd + 1 + size + 1;
    }
  }
}

function shell(command, cwd, environment) {
  return new Promise((accept) => {
    const child = spawn("bash", ["-c", command], { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => accept({ code, output }));
  });
}

// Submodule repositories belong to this worktree. The shared common directory
// holds root objects, but not the linked worktree’s initialized modules.
const gitDirOf = (repository) => execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repository }).toString().trim();
const expandHome = (command, home) => command.replace(/(^|\s)~\//gu, `$1${home}/`);
// What the package manager said about its refusal, without the cyclic-workspace warning that
// leads every run of this workspace.
const saidOf = (output) => output.split("\n").filter((line) => line.trim() && !/cyclic workspace/iu.test(line)).slice(-24).join("\n");

/**
 * Runs `command` over the commit's manifests. `derive` returns the lockfile the command left; `check`
 * only its verdict. The command is the spec's: a frozen check is the release install with
 * `--lockfile-only`; a derivation resolves online so the store learns any new registry package.
 */
async function overManifests({ repository, commit, command, home = process.env.HOME, environment = process.env }) {
  const scratch = mkdtempSync(join(tmpdir(), "workspace-lockfile-"));
  try {
    extractWorkspaceManifests(gitDirOf(repository), commit, scratch);
    const { code, output } = await shell(expandHome(command, home), scratch, environment);
    const lockfile = (() => { try { return readFileSync(join(scratch, LOCKFILE)); } catch { return null; } })();
    return { code, said: saidOf(output), lockfile };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Whether the commit's lockfile satisfies its manifests as the release's frozen install reads them. */
export async function checkWorkspaceLockfile({ repository, commit, install, ...rest }) {
  const frozen = install.split("&&").map((step) => step.trim()).find((step) => /--frozen-lockfile/u.test(step));
  if (frozen === undefined) return { ok: true, said: "" };
  const { code, said } = await overManifests({ repository, commit, command: `${frozen} --lockfile-only`, ...rest });
  return { ok: code === 0, said };
}

/** The lockfile the commit's manifests derive, and whether it differs from the one committed. */
export async function deriveWorkspaceLockfile({ repository, commit, derive, ...rest }) {
  const committed = (() => {
    try { return execFileSync("git", ["show", `${commit}:${LOCKFILE}`], { cwd: repository, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { return null; }
  })();
  const { code, said, lockfile } = await overManifests({ repository, commit, command: derive, ...rest });
  if (code !== 0 || lockfile === null) {
    const error = new Error(`lockfile derivation refused ${commit}: ${said}`);
    error.said = said;
    throw error;
  }
  return { lockfile, changed: committed === null || !committed.equals(lockfile), said };
}
