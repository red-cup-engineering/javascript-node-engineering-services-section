// Commits written as objects, never through a working tree or an index: the integration of a
// repository with hundreds of thousands of paths touches only the trees on the paths it changes,
// so it takes milliseconds where an index rebuild takes minutes, and no other writer's checkout,
// index or HEAD is read or moved.
//
// Each step is written once, synchronously (a producer that lands its files from inside a
// synchronous job calls these directly), and exported again under its async name for callers that
// compose promises; the async forms reject where the synchronous ones throw.
import { execFileSync } from "node:child_process";

export function gitSync(repository, arguments_, { input, env, maxBuffer = 1 << 30 } = {}) {
  try {
    return execFileSync("git", arguments_, { cwd: repository, maxBuffer, input, stdio: ["pipe", "pipe", "pipe"], env: env ? { ...process.env, ...env } : process.env });
  } catch (error) {
    const failure = new Error(`git ${arguments_.join(" ")}: exited ${error.status ?? error.signal}: ${String(error.stderr ?? "").trim()}`);
    failure.status = typeof error.status === "number" ? error.status : 1;
    failure.stdout = String(error.stdout ?? "");
    throw failure;
  }
}
export const gitTextSync = (repository, arguments_, options) => String(gitSync(repository, arguments_, options)).trim();

export const writeBlobSync = (repository, bytes) => gitTextSync(repository, ["hash-object", "-w", "--stdin"], { input: bytes });

/** The object at `path` in `treeish`, or null: `{ mode, type, object }`. */
export function entryAtSync(repository, treeish, path) {
  const listed = gitTextSync(repository, ["ls-tree", "-z", treeish, "--", path]);
  const record = listed.split("\0").find((line) => line.endsWith(`\t${path}`));
  if (!record) return null;
  const [mode, type, object] = record.split("\t")[0].split(" ");
  return { mode, type, object };
}

/**
 * The tree `tree` with each named path set to an entry ({ mode, object }) or removed (null). Only
 * the trees on the changed paths are rewritten, from the root down to each change.
 */
export function replaceInTreeSync(repository, tree, changes) {
  const here = new Map();
  const below = new Map();
  for (const [path, entry] of Object.entries(changes)) {
    const [head, ...rest] = path.split("/");
    if (rest.length === 0) here.set(head, entry);
    else below.set(head, { ...below.get(head), [rest.join("/")]: entry });
  }
  const listed = tree === null ? "" : String(gitSync(repository, ["ls-tree", "-z", tree]));
  const entries = new Map(listed.split("\0").filter(Boolean).map((record) => {
    const [meta, name] = record.split("\t");
    const [mode, type, object] = meta.split(" ");
    return [name, { mode, type, object }];
  }));
  for (const [name, entry] of here) {
    if (entry === null) entries.delete(name);
    else entries.set(name, { mode: entry.mode ?? "100644", type: entry.mode === "160000" ? "commit" : entry.mode === "040000" ? "tree" : "blob", object: entry.object });
  }
  for (const [name, nested] of below) {
    const existing = entries.get(name);
    const subtree = replaceInTreeSync(repository, existing?.type === "tree" ? existing.object : null, nested);
    if (subtree === null) entries.delete(name);
    else entries.set(name, { mode: "040000", type: "tree", object: subtree });
  }
  if (entries.size === 0) return null;
  const input = [...entries].map(([name, { mode, type, object }]) => `${mode} ${type} ${object}\t${name}`).join("\0") + "\0";
  return gitTextSync(repository, ["mktree", "-z"], { input });
}

/** A commit of `tree` over `parents`, authored as the repository's configured identity. */
export const commitTreeSync = (repository, tree, parents, message) =>
  gitTextSync(repository, ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])], { input: message });

export function derivedCommitSync(repository, tree, parents, message) {
  const at = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => Number(gitTextSync(repository, ["show", "-s", "--format=%ct", parent]))));
  const date = `@${at} +0000`;
  return gitTextSync(repository, ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])], { input: message, env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}


export const treeOfSync = (repository, commitish) => gitTextSync(repository, ["rev-parse", "--verify", `${commitish}^{tree}`]);

export const commitOfSync = (repository, ref) => gitTextSync(repository, ["rev-parse", "--verify", `${ref}^{commit}`]);

export function isAncestorSync(repository, ancestor, descendant) {
  try {
    gitSync(repository, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

const later = (step) => async (...arguments_) => step(...arguments_);
export const git = later(gitSync);
export const gitText = later(gitTextSync);
export const writeBlob = later(writeBlobSync);
export const entryAt = later(entryAtSync);
export const replaceInTree = later(replaceInTreeSync);
export const commitTree = later(commitTreeSync);
export const derivedCommit = later(derivedCommitSync);
export const treeOf = later(treeOfSync);
export const commitOf = later(commitOfSync);
export const isAncestor = later(isAncestorSync);
