/**
 * git-tree-at-ref — the repository's tracked tree at a commit, read from git objects alone: no
 * export, no worktree, no checkout. A submodule is read at its gitlink, from its own object store,
 * so a tree view covers FeltOS and Farstone as the commit pins them. Two views of the same
 * repository compare by blob id, which is how a gate reads what a candidate changed without
 * reading what it did not.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const BLOB_BATCH = 4096;

function git(args, { cwd, gitDir, input } = {}) {
  const prefix = gitDir === undefined ? [] : [`--git-dir=${gitDir}`];
  const result = spawnSync("git", [...prefix, ...args], { cwd, input, maxBuffer: Infinity });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr?.toString("utf8").trim() || result.error?.message || `signal ${result.signal}`}`);
  return result.stdout;
}

/** The submodule paths .gitmodules names at a commit, each with its module name. */
function submodulesAt(root, commit, gitDir) {
  let text;
  try { text = git(["show", `${commit}:.gitmodules`], { cwd: root, gitDir }).toString("utf8"); } catch { return new Map(); }
  const paths = new Map();
  for (const match of text.matchAll(/^\[submodule "([^"]+)"\][^[]*?^\s*path\s*=\s*(.+?)\s*$/gmu)) paths.set(match[2], match[1]);
  return paths;
}

/** The object store holding a submodule's commits: the superproject's module directory, else a nested repository at its path. */
function submoduleGitDir(root, path, name, gitDir) {
  const common = git(["rev-parse", "--git-common-dir"], { cwd: root, gitDir }).toString("utf8").trim();
  const modules = join(isAbsolute(common) ? common : join(root, common), "modules", name);
  if (existsSync(modules)) return modules;
  const nested = join(root, path, ".git");
  return existsSync(nested) ? git(["rev-parse", "--absolute-git-dir"], { cwd: join(root, path) }).toString("utf8").trim() : undefined;
}

function lsTree(commit, pathspec, { cwd, gitDir }) {
  const entries = [];
  for (const line of git(["ls-tree", "-r", "-z", "--full-tree", commit, "--", ...pathspec], { cwd, gitDir }).toString("utf8").split("\0")) {
    if (line === "") continue;
    const tab = line.indexOf("\t");
    const [mode, type, id] = line.slice(0, tab).split(" ");
    entries.push({ mode, type, id, path: line.slice(tab + 1) });
  }
  return entries;
}

/**
 * A read-only view of `ref`'s tree under `pathspec` (default `lib`): `blobs`, every tracked file's
 * path mapped to `{ id, store }`; `unreadable`, each gitlink whose commit no local store holds; and
 * `read(paths)`, the named files' contents as a Map of path to Buffer.
 */
export function gitTreeAtRef(root, ref, { pathspec = ["lib"] } = {}) {
  const commit = git(["rev-parse", "--verify", `${ref}^{commit}`], { cwd: root }).toString("utf8").trim();
  const blobs = new Map();
  const unreadable = [];
  const visit = (treeCommit, store, prefix, selection) => {
    const submodules = submodulesAt(root, treeCommit, store);
    for (const entry of lsTree(treeCommit, selection, { cwd: root, gitDir: store })) {
      const path = prefix === "" ? entry.path : `${prefix}/${entry.path}`;
      if (entry.type === "blob") { blobs.set(path, { id: entry.id, store }); continue; }
      if (entry.type !== "commit") continue;
      const nestedStore = submoduleGitDir(root, path, submodules.get(entry.path) ?? entry.path, store);
      if (nestedStore === undefined) { unreadable.push(Object.freeze({ path, commit: entry.id })); continue; }
      // An unread local child stays explicit. Descendants are read through the
      // parent's own object store, never from a moving remote branch.
      try { git(["cat-file", "-e", `${entry.id}^{commit}`], { cwd: root, gitDir: nestedStore }); }
      catch { unreadable.push(Object.freeze({ path, commit: entry.id })); continue; }
      visit(entry.id, nestedStore, path, []);
    }
  };
  visit(commit, undefined, "", pathspec);
  return Object.freeze({
    ref,
    commit,
    blobs,
    unreadable: Object.freeze(unreadable),
    read: (paths) => readBlobs(root, paths.map((path) => [path, blobs.get(path)]).filter(([, blob]) => blob !== undefined)),
  });
}

/** Contents of blobs by id, batched per object store through `git cat-file --batch`. */
function readBlobs(root, entries) {
  const contents = new Map();
  const byStore = new Map();
  for (const [path, blob] of entries) {
    if (!byStore.has(blob.store)) byStore.set(blob.store, []);
    byStore.get(blob.store).push([path, blob.id]);
  }
  for (const [store, pairs] of byStore) {
    for (let start = 0; start < pairs.length; start += BLOB_BATCH) {
      const batch = pairs.slice(start, start + BLOB_BATCH);
      const output = git(["cat-file", "--batch"], { cwd: root, gitDir: store, input: `${batch.map(([, id]) => id).join("\n")}\n` });
      let offset = 0;
      for (const [path] of batch) {
        const newline = output.indexOf(0x0a, offset);
        const header = output.subarray(offset, newline).toString("utf8").split(" ");
        if (header[1] === "missing") { offset = newline + 1; continue; }
        const size = Number(header[2]);
        contents.set(path, output.subarray(newline + 1, newline + 1 + size));
        offset = newline + 1 + size + 1;
      }
    }
  }
  return contents;
}

/** The paths whose content differs between two views (added, removed or changed), in order. */
export function changedPaths(before, after) {
  const paths = new Set();
  for (const [path, blob] of before.blobs) if (after.blobs.get(path)?.id !== blob.id) paths.add(path);
  for (const path of after.blobs.keys()) if (!before.blobs.has(path)) paths.add(path);
  return [...paths].sort();
}
