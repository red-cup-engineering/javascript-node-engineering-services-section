// What a release of a commit is made of, read from git and never from bytes: the files the spec's
// archive pathspecs select at the commit, each as the blob object git already content-addressed,
// across the repositories the commit composes at its gitlinks. A release is named by a digest of
// that selection (releaseIdentity), so naming it costs one tree walk where hashing a staged tree
// reads every byte; and a release is staged from the one before it by applying the difference
// between the two selections (stageFromPrevious) instead of archiving the whole tree again.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gitSync, gitTextSync } from "./git-objects.mjs";
import { derivedPaths } from "./release-digest.mjs";
import { carryFiles } from "./tree-carry.mjs";

/** Bump when what the identity is computed from changes; a receipt names the version that named it. */
export const IDENTITY_VERSION = 1;

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const excluding = (pathspec) => /^:(!|\^|\([^)]*exclude)/u.test(pathspec);

/**
 * A commit composes other repositories at its gitlinks. A submodule the commit marks `update = none`
 * is data with its own lifecycle (a channel's production state) and is not part of the composition.
 * Returns `{ composed: [{ name, path, url, object }], common }`, `common` being the repository's git
 * common directory, beside which submodule caches are kept.
 */
export function composedModules(repository, commit) {
  const gitlinks = new Map();
  for (const entry of gitTextSync(repository, ["ls-tree", "-r", "-z", "--full-tree", commit]).split("\0")) {
    const match = /^160000 commit ([0-9a-f]{40})\t(.+)$/u.exec(entry);
    if (match) gitlinks.set(match[2], match[1]);
  }
  const modules = new Map();
  if (gitlinks.size > 0) {
    const config = gitTextSync(repository, ["config", "--blob", `${commit}:.gitmodules`, "-z", "--get-regexp", "^submodule\\..*\\.(path|url|update)$"]);
    for (const record of config.split("\0").filter(Boolean)) {
      const [key, value] = record.split("\n");
      const [, name, field] = /^submodule\.(.+)\.(path|url|update)$/u.exec(key);
      modules.set(name, { ...modules.get(name), name, [field]: value });
    }
  }
  const byPath = new Map([...modules.values()].map((module) => [module.path, module]));
  const composed = [...gitlinks].map(([path, object]) => {
    const module = byPath.get(path);
    if (!module?.url) throw new Error(`gitlink ${path} has no submodule in ${commit}:.gitmodules`);
    return { ...module, object };
  }).filter((module) => module.update !== "none");
  return { composed, common: resolve(repository, gitTextSync(repository, ["rev-parse", "--git-common-dir"])) };
}

/**
 * The checkout's own submodule repository when it already holds the commit; otherwise a bare cache
 * beside it, fetched from the submodule's URL, so a release never writes the checkout's tree.
 */
export function moduleRepository(common, module) {
  const has = (gitDirectory) => existsSync(gitDirectory) && spawnSync("git", ["--git-dir", gitDirectory, "cat-file", "-e", `${module.object}^{commit}`]).status === 0;
  const own = resolve(common, "modules", module.name);
  if (has(own)) return own;
  const cache = resolve(common, "composition", `${module.name}.git`);
  if (!existsSync(cache)) gitSync(common, ["clone", "--bare", "--quiet", module.url, cache]);
  if (!has(cache)) {
    try { gitSync(common, ["--git-dir", cache, "fetch", "--quiet", "--no-tags", module.url, module.object]); }
    catch { gitSync(common, ["--git-dir", cache, "fetch", "--quiet", "--no-tags", module.url, "+refs/heads/*:refs/heads/*"]); }
  }
  if (!has(cache)) throw new Error(`submodule ${module.name} at ${module.path}: ${module.url} has no commit ${module.object}`);
  return cache;
}

/**
 * The submodule's commit set at its path in a tree of its own repository, so the group's pathspecs,
 * which name paths of the composed tree, apply to it as they are written.
 */
export function moduleTree(repository, common, gitDirectory, commit, module) {
  const index = resolve(common, `composition-${commit}-${process.pid}.index`);
  const git = (arguments_) => gitTextSync(repository, ["--git-dir", gitDirectory, "--work-tree", repository, ...arguments_], { env: { GIT_INDEX_FILE: index } });
  rmSync(index, { force: true });
  try {
    git(["read-tree", `--prefix=${module.path}/`, module.object]);
    return git(["write-tree"]);
  } finally {
    rmSync(index, { force: true });
  }
}

// The files `git archive tree -- pathspecs` would write, as { mode, oid, path }: gitlinks are listed
// with mode 160000 and are not files.
function listed(repository, gitDirectory, tree, pathspecs) {
  const raw = String(gitSync(repository, [...(gitDirectory ? ["--git-dir", gitDirectory] : []), "diff", "--raw", "-z", "--no-abbrev", "--no-renames", EMPTY_TREE, tree, "--", ...pathspecs]));
  const fields = raw.split("\0");
  const entries = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const meta = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) (\w)/u.exec(fields[index]);
    if (meta) entries.push({ mode: meta[2], oid: meta[4], path: fields[index + 1] });
  }
  return withoutExportIgnored(repository, gitDirectory, tree, entries);
}

// `git archive` leaves out what the tree's own .gitattributes marks export-ignore, so a listing of
// what it would write does too.
function withoutExportIgnored(repository, gitDirectory, tree, entries) {
  const files = entries.filter((entry) => entry.mode !== "160000");
  if (files.length === 0) return entries;
  const raw = String(gitSync(repository, [...(gitDirectory ? ["--git-dir", gitDirectory] : []), "check-attr", `--source=${tree}`, "-z", "--stdin", "export-ignore"], { input: `${files.map((entry) => entry.path).join("\0")}\0` }));
  const fields = raw.split("\0");
  const ignored = new Set();
  for (let index = 0; index + 2 < fields.length; index += 3) if (fields[index + 2] === "set") ignored.add(fields[index]);
  return ignored.size === 0 ? entries : entries.filter((entry) => !ignored.has(entry.path));
}

/**
 * Every file the release of `commit` carries, sorted by path: `[{ mode, oid, path }]`, where `oid` is
 * the git blob (or, for a symlink, its link blob). `archives` is the spec's list of pathspec groups.
 * Files at `derived` paths are the install's to build and are not listed.
 */
export function selectionEntries({ repository, commit, archives, derived = [], modules }) {
  const skipped = derivedPaths(derived);
  const { composed, common } = modules ?? composedModules(repository, commit);
  const found = new Map();
  const add = (entries) => { for (const entry of entries) if (entry.mode !== "160000" && !skipped.some(path => entry.path === path || entry.path.startsWith(path + "/"))) found.set(entry.path, entry); };
  for (const pathspecs of archives) {
    const here = listed(repository, undefined, commit, pathspecs);
    add(here);
    const gitlinks = new Set(here.filter((entry) => entry.mode === "160000").map((entry) => entry.path));
    const within = (module) => pathspecs.some((pathspec) => !excluding(pathspec) && pathspec.startsWith(`${module.path}/`));
    for (const module of composed.filter((candidate) => gitlinks.has(candidate.path) || within(candidate))) {
      const gitDirectory = moduleRepository(common, module);
      add(listed(repository, gitDirectory, moduleTree(repository, common, gitDirectory, commit, module), pathspecs));
    }
  }
  return [...found.values()].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/**
 * A release's identity: sha256 over a canonical JSON of the version, the pathspecs that selected its
 * files, the derived paths (which paths are derived is part of it; their bytes are not) and the
 * digest of the selection listing (mode, blob id and path of every selected file). It changes when a
 * tracked file the pathspecs select changes, and not when anything else in the commit does.
 */
export function releaseIdentity({ repository, commit, archives, derived = [], modules }) {
  const declared = derivedPaths(derived);
  const entries = selectionEntries({ repository, commit, archives, modules });
  const skipped = declared;
  const listing = createHash("sha256");
  for (const { mode, oid, path } of entries) if (!skipped.some(prefix => path === prefix || path.startsWith(prefix + "/"))) listing.update(`${mode} ${oid} ${path}\n`);
  const canonical = JSON.stringify({ identityVersion: IDENTITY_VERSION, archives, derived: declared, selection: listing.digest("hex") });
  return { version: IDENTITY_VERSION, digest: createHash("sha256").update(canonical).digest("hex"), files: entries.length, entries };
}

// `git archive <arguments> | tar -x` into `stage`, one pipeline, failing if either end does.
function archiveInto(stage, gitDirectory, treeish, paths, cwd) {
  const result = spawnSync("bash", ["-o", "pipefail", "-c", 'stage=$1; shift; mkdir -p "$stage" && git "$@" | tar -x -C "$stage"', "bash", stage, ...(gitDirectory ? ["--git-dir", gitDirectory] : []), "archive", "--format=tar", treeish, "--", ...paths], { cwd, stdio: ["ignore", "inherit", "pipe"] });
  if (result.status !== 0) throw new Error(`git archive ${treeish}: exited ${result.status ?? result.signal}: ${String(result.stderr).trim()}`);
}

const reaches = (repository, gitDirectory, tree, pathspec, exclusions) =>
  spawnSync("git", [...(gitDirectory ? ["--git-dir", gitDirectory] : []), "diff", "--quiet", "--no-renames", EMPTY_TREE, tree, "--", pathspec, ...exclusions], { cwd: repository, stdio: "ignore" }).status === 1;

/**
 * The whole commit archived into `stage`: each pathspec group from the commit and from every
 * repository it composes that the group reaches (what release-git-commit does, here for a local
 * stage; it is the baseline an incremental stage must equal).
 */
export function archiveCommit({ repository, commit, archives, stage }) {
  const { composed, common } = composedModules(repository, commit);
  for (const pathspecs of archives) {
    const exclusions = pathspecs.filter(excluding);
    const gitlinks = new Set(listed(repository, undefined, commit, pathspecs).filter((entry) => entry.mode === "160000").map((entry) => entry.path));
    const within = (module) => pathspecs.some((pathspec) => !excluding(pathspec) && pathspec.startsWith(`${module.path}/`));
    const sources = [{ gitDirectory: undefined, tree: commit }, ...composed.filter((module) => gitlinks.has(module.path) || within(module)).map((module) => {
      const gitDirectory = moduleRepository(common, module);
      return { gitDirectory, tree: moduleTree(repository, common, gitDirectory, commit, module) };
    })];
    for (const { gitDirectory, tree } of sources) {
      const including = pathspecs.filter((pathspec) => !excluding(pathspec) && reaches(repository, gitDirectory, tree, pathspec, exclusions));
      if (including.length > 0) archiveInto(stage, gitDirectory, tree, [...including, ...exclusions], repository);
    }
  }
}

/** The git blob id of `bytes`: what a tracked file's identity is. */
export const blobId = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

/**
 * Refuses a staged tree whose bytes are not the ones its identity names. Every entry of `entries`
 * (`{ mode, oid, path }`) is read back from `stage` and its blob id (for a symlink, the blob of its
 * target) and executable bit compared with what git lists; the first `limit` mismatches are named
 * in the thrown error, path and reason. Returns the number of entries verified.
 */
export function verifyStagedEntries({ stage, entries, limit = 10 }) {
  const wrong = [];
  for (const { mode, oid, path } of entries) {
    const file = join(stage, path);
    let why = null;
    try {
      const stat = lstatSync(file);
      if (mode === "120000") why = !stat.isSymbolicLink() ? "not a link" : blobId(Buffer.from(readlinkSync(file))) !== oid ? "link differs" : null;
      else if (!stat.isFile()) why = "not a file";
      else if (blobId(readFileSync(file)) !== oid) why = "bytes differ";
      else if ((stat.mode & 0o111 ? "100755" : "100644") !== mode) why = "mode differs";
    } catch (error) { why = error.code === "ENOENT" ? "missing" : `unreadable (${error.code ?? error.message})`; }
    if (why) wrong.push(`${path}: ${why}`);
  }
  if (wrong.length > 0) throw new Error(`the staged tree does not hold the bytes of its commit: ${wrong.length} of ${entries.length} verified paths differ (${wrong.slice(0, limit).join("; ")})`);
  return entries.length;
}

// An evenly spaced sample of `count` of `entries`, the same for the same input.
const sampled = (entries, count) => {
  if (entries.length <= count) return entries;
  const step = entries.length / count;
  return Array.from({ length: count }, (_, index) => entries[Math.floor(index * step)]);
};


// A tracked file's identity is its blob, and the difference of two selections is exactly the paths
// whose (mode, blob) differ.
function difference(before, after) {
  const was = new Map(before.map((entry) => [entry.path, entry]));
  const now = new Map(after.map((entry) => [entry.path, entry]));
  const removed = before.filter((entry) => !now.has(entry.path)).map((entry) => entry.path);
  const written = after.filter((entry) => { const old = was.get(entry.path); return !old || old.oid !== entry.oid || old.mode !== entry.mode; });
  return { removed, written };
}

/**
 * Stage the release of `commit` in `stage` from `previousRelease`, the release of `previousCommit`,
 * and report what was applied. The previous release's tracked files are carried by reflink where
 * the filesystem has them and by hard link where it does not; node_modules and the derived paths are
 * never carried (the install builds the first, and it writes the second in place, which a link
 * would carry back into a release that is immutable). Then the paths whose blobs differ between the
 * two selections are written from `git archive` (which replaces a file by unlinking it first, so a
 * linked file is never written through) and the paths that are gone are removed. The result is the
 * tree a full archive of `commit` makes, save the derived files and receipt.
 */
/**
 * What staging `commit` from the release of `previousCommit` does, decided from git alone, so a
 * remote host is staged by the same plan: `linked` are the previous release's entries carried as
 * they are (same blob and mode, not derived, not touched by the commit), `written` the entries
 * written from git, `removed` the paths the commit drops. `isDerived` names a derived path.
 */
export function stagePlan({ repository, previousCommit, commit, archives, derived = [], selection }) {
  const declared = derivedPaths(derived);
  const before = selectionEntries({ repository, commit: previousCommit, archives });
  // `selection` is the release's own listing when the caller has it (releaseIdentity returns it, derived
  // paths included), so the walk is not repeated.
  const after = selection ?? selectionEntries({ repository, commit, archives });
  const isDerived = path => declared.some(prefix => path === prefix || path.startsWith(prefix + "/"));
  // What is carried is exactly the files both selections hold with the same blob and mode, and never
  // a path the commit changes, adds, removes or derives: those are the delta's, written from git
  // only once every carry has finished, so no link can land on, or race with, a written path.
  const delta = difference(before, after);
  const changed = new Set([...delta.removed, ...delta.written.map((entry) => entry.path), ...after.filter((entry) => isDerived(entry.path)).map((entry) => entry.path)]);
  const linked = before.filter((entry) => !isDerived(entry.path) && !changed.has(entry.path));
  // A derived path is never carried, so every tracked file at one is written from git, as a full
  // archive would write it; the install then rebuilds it in place.
  const removed = delta.removed.filter((path) => !isDerived(path));
  const written = [...new Map([...delta.written, ...after.filter((entry) => isDerived(entry.path))].map((entry) => [entry.path, entry])).values()];
  return { linked, written, removed, files: after.length, isDerived };
}

/** `entries` grouped by the repository that archives them: this commit's own, then each composed one. */
export function writtenSources({ repository, commit, entries }) {
  const { composed, common } = composedModules(repository, commit);
  const insideModule = (path) => composed.find((module) => path.startsWith(`${module.path}/`));
  const sources = [{ gitDirectory: undefined, tree: commit, entries: entries.filter((entry) => !insideModule(entry.path)) }];
  for (const module of new Set(entries.map((entry) => insideModule(entry.path)).filter(Boolean))) {
    const gitDirectory = moduleRepository(common, module);
    sources.push({ gitDirectory, tree: moduleTree(repository, common, gitDirectory, commit, module), entries: entries.filter((entry) => insideModule(entry.path) === module) });
  }
  return sources.filter((source) => source.entries.length > 0);
}

export const literalPath = (path) => `:(literal)${path}`;
export const WRITE_BATCH = 400;
export { sampled as sampledEntries };

export async function stageFromPrevious({ repository, previousCommit, commit, archives, derived = [], previousRelease, stage, selection, jobs = 16, sampleSize = 2000 }) {
  const { linked, written, removed, files } = stagePlan({ repository, previousCommit, commit, archives, derived, selection });
  rmSync(stage, { recursive: true, force: true });
  // Only what git tracks is carried, so nothing a previous install left beside it comes along.
  mkdirSync(stage, { recursive: true });
  const probe = join(stage, ".link-probe");
  writeFileSync(probe, "");
  const reflinks = (() => { try { copyFileSync(probe, `${probe}.copy`, fsConstants.COPYFILE_FICLONE_FORCE); return true; } catch { return false; } finally { rmSync(`${probe}.copy`, { force: true }); } })();
  rmSync(probe, { force: true });
  await carryFiles({ from: previousRelease, to: stage, entries: linked, reflinks, jobs });
  for (const path of removed) {
    rmSync(resolve(stage, path), { force: true, recursive: true });
    // Directories a removed file leaves empty go with it.
    for (let directory = resolve(stage, path, ".."); directory !== resolve(stage) && directory.startsWith(`${resolve(stage)}/`); directory = resolve(directory, "..")) {
      const gone = spawnSync("rmdir", [directory], { stdio: "ignore" });
      if (gone.status !== 0) break;
    }
  }
  // A path that changed from file to directory or back must not be written through the old kind.
  for (const { gitDirectory, tree, entries } of writtenSources({ repository, commit, entries: written })) {
    for (let start = 0; start < entries.length; start += WRITE_BATCH) {
      archiveInto(stage, gitDirectory, tree, entries.slice(start, start + WRITE_BATCH).map((entry) => literalPath(entry.path)), repository);
    }
  }
  // Never a tree whose bytes differ from its identity: every path the delta wrote is read back and
  // compared with its blob, and so is a sample of the carried ones (the carry's source is the
  // running release, which is only as good as it was when it was made).
  const verified = verifyStagedEntries({ stage, entries: written.filter((entry) => entry.mode !== "160000") });
  const sample = verifyStagedEntries({ stage, entries: sampled(linked, sampleSize) });
  for (const path of removed) if (existsSync(resolve(stage, path))) throw new Error(`the staged tree still holds ${path}, which its commit removed`);
  return { carried: linked.length, removed: removed.length, written: written.length, files, verified, sampled: sample };
}

