#!/usr/bin/env node
// Screens a writer's change ledger (one repository-relative path per line, or an absolute path
// under the repository) into the exact list the engineer should hand the commit operator: a
// directory entry (a moved or deleted package) expands to the files under it now plus the files
// tracked there at HEAD; a path that never changed, that sits inside another hand's held area
// (data/records/house-held-areas.json), that is a node_modules/.wrangler/cache artifact, or whose
// change would carry another hand's hunk (a reachInSection import, added or, for a brand-new file,
// present at all) is dropped and named on stderr with its reason. This replaces the one-off
// screen-ledger*.mjs scratchpad scripts a writer had to hand-edit for every session's held areas.
//
//   node screen-change-ledger.mjs --ledger <file> [--root /home/emsenn/info] [--allow <regex>]...
//
// Kept paths print one per line on stdout; a JSON summary and one drop line per path print to
// stderr. Exit 0 always: screening reports, it does not fail the writer's session.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, relative, resolve } from "node:path";
import { SPECIFIER, stripCommentsAndLiterals } from "./audit-layer-imports.mjs";
import { argument } from "../src/argv.mjs";

const IGNORED = /(^|\/)(node_modules|\.wrangler|cache)(\/|$)/u;
const WALK_SKIP = new Set(["node_modules", ".git", ".wrangler"]);

/** Runs one git subcommand with `root` as the working directory; the caller reads `.status`/`.stdout`. Exported so a caller that needs another git query (a move's blob hashes, an untracked-file listing) runs it through this one spawn point rather than copying it. */
export function git(root, args) {
  return spawnSync("git", args, { cwd: root, maxBuffer: 1 << 28 });
}

/** The text of `ref` (e.g. "HEAD:some/path") at the repository, or undefined when git cannot show it. */
export function gitShowBuffer(root, ref) {
  const result = git(root, ["show", ref]);
  return result.status === 0 ? result.stdout : undefined;
}

/** The tracked files at HEAD under `path` (exactly [path] when path is itself a tracked file, [] when untracked). */
export function gitTrackedFilesUnder(root, path) {
  const result = git(root, ["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", path]);
  if (result.status !== 0) return [];
  return result.stdout.toString("utf8").split("\0").filter(Boolean);
}

/**
 * One path's change state against HEAD: "absent-both" (untracked and missing on disk), "new"
 * (untracked, present on disk), "deleted" (tracked, missing on disk), "unchanged" (tracked, present,
 * byte-identical), or "changed" (tracked, present, different).
 */
export function classifyChangeState(path, root) {
  const headBuffer = gitShowBuffer(root, `HEAD:${path}`);
  let diskBuffer;
  try { diskBuffer = readFileSync(join(root, path)); } catch { diskBuffer = undefined; }
  const trackedAtHead = headBuffer !== undefined;
  const onDisk = diskBuffer !== undefined;
  if (!trackedAtHead && !onDisk) return "absent-both";
  if (!trackedAtHead) return "new";
  if (!onDisk) return "deleted";
  return Buffer.compare(headBuffer, diskBuffer) === 0 ? "unchanged" : "changed";
}

/** One ledger line normalized to a repository-relative path, or undefined for a blank line. */
export function normalizeLedgerLine(rawLine, root) {
  const trimmed = rawLine.trim();
  if (trimmed === "") return undefined;
  const path = trimmed.startsWith("/") ? relative(root, trimmed).split("\\").join("/") : trimmed.split("\\").join("/");
  return path.replace(/\/+$/u, "");
}

/** The ledger file's lines, normalized to repository-relative paths, blank lines dropped, order preserved, duplicates removed. */
export function readLedgerEntries(ledgerFile, root) {
  const lines = readFileSync(ledgerFile, "utf8").split("\n");
  const seen = new Set();
  const entries = [];
  for (const line of lines) {
    const normalized = normalizeLedgerLine(line, root);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push(normalized);
  }
  return entries;
}

function* walkFiles(directory) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (WALK_SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walkFiles(path);
    else if (entry.isFile()) yield path;
  }
}

/** One ledger entry expanded to the files it names now: itself if a file, its files (on disk now, plus tracked at HEAD) if a directory, or itself unchanged if it names neither. */
export function expandEntry(path, root) {
  const absolute = join(root, path);
  let stat;
  try { stat = statSync(absolute); } catch { stat = undefined; }
  const files = new Set();
  if (stat?.isDirectory()) {
    for (const file of walkFiles(absolute)) files.add(relative(root, file).split("\\").join("/"));
  } else if (stat?.isFile()) {
    files.add(path);
  }
  for (const tracked of gitTrackedFilesUnder(root, path)) files.add(tracked);
  if (files.size === 0) files.add(path);
  return [...files];
}

/** Every ledger entry expanded, flattened, and deduplicated, order preserved. */
export function expandEntries(entries, root) {
  const seen = new Set();
  const expanded = [];
  for (const entry of entries) for (const file of expandEntry(entry, root)) { if (!seen.has(file)) { seen.add(file); expanded.push(file); } }
  return expanded;
}

const UNTRACKED_SOURCE = /\.(mjs|cjs|js|json)$/u;
const UNTRACKED_IGNORED = /(^|\/)(node_modules|dist|\.wrangler)(\/|$)/u;

/**
 * The nested package directory (a directory under `packageDir`, other than `packageDir` itself, that
 * has its own package.json) that owns `path`: the deepest such directory found while walking up from
 * `path`'s own directory toward `packageDir`, or undefined when nothing between them has a
 * package.json of its own. Existence is checked on disk (not just what git tracks), so a nested
 * package still being materialized — its own package.json itself untracked — is still recognized as
 * a section of its own rather than folded into its parent's untracked-file scan.
 */
export function nestedPackageOwner(path, packageDir, root) {
  let directory = dirname(path);
  while (directory !== packageDir && directory !== "." && directory !== "/" && directory.startsWith(packageDir)) {
    if (existsSync(join(root, directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/**
 * For each package directory, the untracked, non-ignored .mjs/.cjs/.js/.json source files under it
 * (`git ls-files --others --exclude-standard`) that `ledgerPaths` does not name, each with the
 * tracked files under that package whose current text names it by basename — a package.json
 * "scripts" entry pointing at a file nobody `git add`ed is the incident this exists for; an import
 * statement referencing it by basename is another. A commit built from a ledger that omits a file
 * some tracked file already depends on ships broken.
 *
 * Two kinds of file are not this package's business to report, and are excluded before anything else:
 * a path matching `heldAreas` (another hand's own uncommitted work, already excluded from everything
 * else a ledger touches), and a path that belongs to a *nested* package — a directory under this one
 * that has its own package.json — unless that nested package is itself one of `packages` (one the
 * ledger owns). Without this, a ledger that merely edits a section's own package.json is treated as
 * "owning" the whole section directory, and every held or nested package's untracked file underneath
 * it (another hand's in-progress translation, say) gets reported as if this ledger omitted it.
 */
export function omittedUntrackedFiles({ root, packages, ledgerPaths, heldAreas }) {
  const ledgerSet = new Set(ledgerPaths);
  const ownedPackages = new Set(packages);
  const heldPatterns = (heldAreas?.areas ?? []).map((area) => new RegExp(area.pattern, "u"));
  const omitted = [];
  for (const packageDir of packages) {
    const result = git(root, ["ls-files", "--others", "--exclude-standard", "--", packageDir]);
    const untracked = result.status === 0 ? result.stdout.toString("utf8").split("\n").filter(Boolean) : [];
    let trackedFiles;
    for (const path of untracked) {
      if (!UNTRACKED_SOURCE.test(path) || UNTRACKED_IGNORED.test(path) || ledgerSet.has(path)) continue;
      if (heldPatterns.some((pattern) => pattern.test(path))) continue;
      const nestedOwner = nestedPackageOwner(path, packageDir, root);
      if (nestedOwner !== undefined && !ownedPackages.has(nestedOwner)) continue;
      trackedFiles ??= gitTrackedFilesUnder(root, packageDir);
      const base = basename(path);
      const importedBy = [];
      for (const trackedPath of trackedFiles) {
        let text;
        try { text = readFileSync(join(root, trackedPath), "utf8"); } catch { continue; }
        if (text.includes(base)) importedBy.push(trackedPath);
      }
      omitted.push({ package: packageDir, path, importedBy });
    }
  }
  return omitted;
}

/** The held-areas record at its house path, or the record read from an explicit path. */
export function readHeldAreas(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function matchesAny(patterns, text) {
  return patterns.some((pattern) => new RegExp(pattern, "u").test(text));
}

/** The reach-in specifiers (matching `reachInSections`) among `text`'s real specifiers — `text` masked with stripCommentsAndLiterals first, so a comment or string holding an import-shaped line is never one of them. */
function reachInSpecifiersOf(text, reachInSections) {
  const found = new Set();
  for (const match of stripCommentsAndLiterals(text).matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (matchesAny(reachInSections, specifier)) found.add(specifier);
  }
  return found;
}

/**
 * True when a tracked file's current (masked) text names a reachInSection specifier its HEAD text
 * did not — a newly added reach-in import, rather than one already there before this hand's
 * change — or an untracked file's own masked imports reach into one at all.
 */
export function carriesReachInHunk(path, root, reachInSections) {
  if (reachInSections.length === 0) return false;
  const state = classifyChangeState(path, root);
  const absolute = join(root, path);
  if (state === "changed") {
    let diskText;
    try { diskText = readFileSync(absolute, "utf8"); } catch { return false; }
    const headBuffer = gitShowBuffer(root, `HEAD:${path}`);
    const before = reachInSpecifiersOf(headBuffer ? headBuffer.toString("utf8") : "", reachInSections);
    for (const specifier of reachInSpecifiersOf(diskText, reachInSections)) if (!before.has(specifier)) return true;
    return false;
  }
  if (state === "new") {
    let text;
    try { text = readFileSync(absolute, "utf8"); } catch { return false; }
    return reachInSpecifiersOf(text, reachInSections).size > 0;
  }
  return false;
}

/**
 * Screens a ledger against the repository and the house-held-areas record.
 * @returns {{kept: string[], dropped: {path: string, reason: string}[], summary: object}}
 */
export function screenChangeLedger({ ledgerFile, root, allow = [], heldAreas }) {
  const entries = readLedgerEntries(ledgerFile, root);
  const expanded = expandEntries(entries, root);
  const kept = [];
  const dropped = [];
  const counts = { unchanged: 0, held: 0, codex: 0, ignored: 0 };
  for (const path of expanded) {
    if (IGNORED.test(path)) { dropped.push({ path, reason: "ignored" }); counts.ignored++; continue; }
    const state = classifyChangeState(path, root);
    if (state === "unchanged" || state === "absent-both") { dropped.push({ path, reason: "unchanged" }); counts.unchanged++; continue; }
    const released = allow.some((pattern) => new RegExp(pattern, "u").test(path));
    if (!released) {
      const heldArea = heldAreas.areas.find((area) => new RegExp(area.pattern, "u").test(path));
      if (heldArea) { dropped.push({ path, reason: `held:${heldArea.holder}:${heldArea.pattern}` }); counts.held++; continue; }
    }
    if (carriesReachInHunk(path, root, heldAreas.reachInSections ?? [])) { dropped.push({ path, reason: "codex" }); counts.codex++; continue; }
    kept.push(path);
  }
  const summary = { input: entries.length, kept: kept.length, unchanged: counts.unchanged, held: counts.held, codex: counts.codex, ignored: counts.ignored, expanded: expanded.length };
  return { kept, dropped, summary };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const collect = (name) => { const values = []; for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) values.push(args[i + 1]); return values; };
  const root = resolve(argument("--root", args) || process.cwd());
  const here = dirname(new URL(import.meta.url).pathname);
  const heldAreas = readHeldAreas(join(here, "../data/records/house-held-areas.json"));
  const ledgerFile = argument("--ledger", args);
  if (!ledgerFile) { process.stderr.write("usage: screen-change-ledger.mjs --ledger <file> [--root <repo>] [--allow <regex>]...\n"); process.exit(0); }
  const { kept, dropped, summary } = screenChangeLedger({ ledgerFile, root, allow: collect("--allow"), heldAreas });
  process.stderr.write(`${JSON.stringify(summary)}\n`);
  for (const { path, reason } of dropped) process.stderr.write(`${reason}: ${path}\n`);
  process.stdout.write(kept.length ? `${kept.join("\n")}\n` : "");
}
