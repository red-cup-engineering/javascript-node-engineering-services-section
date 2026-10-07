#!/usr/bin/env node
// Audits every source file under lib and dev for a phantom import: a house-scoped specifier that
// names no discovered house package, or names a package but a subpath that package's own
// package.json does not export (and, when the package has no `exports` field, that resolves to no
// file on disk); or a relative specifier that resolves to no file on disk. A grep-based scan misses
// binary-looking source (a false negative that cost a prior writer real time); this reads every file
// as utf8 through fs instead, so nothing is skipped on a heuristic.
//
// `--ref <git ref>` audits a read-only export of lib/emsenn/services/561-group at that ref (see
// exportHouseTreeAtRef) instead of the working tree, resolving discovered package directories under
// the export's temp root — that directory is all of `lib` in this repository, so only `dev` (never
// under it) is unavailable this way and contributes no findings at a ref. `refCache`, a Map keyed by
// ref, lets several calls at the same ref share one export rather than each re-archiving the tree.
//
// At a ref, a relative import whose target is untracked in the working tree (another hand's
// in-flight file, never committed) is simply absent from the export — indistinguishable, on its
// face, from a genuinely broken import. `heldAreas` (data/records/house-held-areas.json) names
// those areas by pattern; when the importer or the resolved target of what would otherwise be a
// "no-file" finding lies in one, the finding is reported with cause "held-untracked" instead, so a
// ref's honest count separates another hand's untracked, uncommitted work from a real break.
//
//   node audit-phantom-imports.mjs [--root /home/emsenn/info] [--held-areas <house-held-areas.json>] [--package <dir>] [--ref <git ref>] [--include-tests] [--summary]
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { SPECIFIER, stripCommentsAndLiterals } from "./audit-layer-imports.mjs";
import { exportHouseTreeAtRef } from "./export-house-tree-at-ref.mjs";
import { owningPackage } from "./measure-house-tree.mjs";
import { readHeldAreas } from "./screen-change-ledger.mjs";
import { argument } from "../src/argv.mjs";
import { discoverHousePackages } from "../src/discover-house-packages.mjs";

const SKIP = new Set(["node_modules", ".git", "dist", "legacy", ".tmp", ".cache", "coverage", ".wrangler"]);
const SOURCE = /\.(mjs|cjs|js|mts|cts|ts)$/u;
const HOUSE_SCOPE = /^@(red-cup-engineering|lenticule-science|561-group|emsenn|causeway-services|coesite-operations)\//u;
const WALK_ROOTS = Object.freeze(["lib", "dev"]);
const FILE_SUFFIXES = Object.freeze(["", ".mjs", ".js", ".cjs", "/index.mjs"]);
// A test fixture's string literals are not import statements a house package has to honor: a
// scratch specifier written into javascript-import-lattice.test.mjs, translate-typescript-package
// .test.mjs, or audit-layer-imports.test.mjs is not a phantom import, it is the fixture text the
// SPECIFIER regex happens to also match. Skipped by default; --include-tests scans them anyway.
const TEST_FILE = /\.test\.[^/.]+$/u;
const TEST_DIRECTORY = /(^|\/)test(\/|$)/u;

/** `heldAreas.areas` (or none) compiled to RegExps once per call, rather than re-parsed per specifier. */
function heldAreaPatterns(heldAreas) {
  return (heldAreas?.areas ?? []).map((area) => new RegExp(area.pattern, "u"));
}

/** True when `path` matches one of `patterns` — a repository-relative path lying in a held area. */
function inHeldArea(path, patterns) {
  return path !== undefined && patterns.some((pattern) => pattern.test(path));
}

function* walk(directory) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && SOURCE.test(entry.name) && !/\.d\.(mts|cts|ts)$/u.test(entry.name)) yield path;
  }
}

/** True when some candidate built from `base` plus each of FILE_SUFFIXES exists on disk. */
export function resolvesToFile(base) {
  return FILE_SUFFIXES.some((suffix) => existsSync(`${base}${suffix}`));
}

/** True when `subpath` (no leading "./") has an entry in a package.json `exports` map, exact or a single-"*" pattern. */
export function exportsSubpath(exportsField, subpath) {
  const key = `./${subpath}`;
  if (key in exportsField) return true;
  for (const exportKey of Object.keys(exportsField)) {
    if (!exportKey.includes("*")) continue;
    const [prefix, suffix] = exportKey.split("*");
    if (key.startsWith(prefix) && key.endsWith(suffix) && key.length >= prefix.length + suffix.length) return true;
  }
  return false;
}

/** A package's declared `servedProjections` (package.json array of {from, to}), or none when absent, malformed, or unreadable. */
function servedProjectionsOf(root, packageDirectory) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(root, packageDirectory, "package.json"), "utf8")); } catch { return []; }
  return Array.isArray(manifest.servedProjections) ? manifest.servedProjections : [];
}

/**
 * True when a relative specifier that failed to resolve directly resolves instead through one of
 * `packageDirectory`'s declared `servedProjections`: a package that copies or renders files into a
 * served directory at build or serve time (a projector's browserRuntime(), a build script's
 * copyFile calls, a sync-public script) declares each such projection as `{ from, to }` in its
 * package.json, `from` and `to` both package-relative. `targetAbsolute` (the specifier resolved
 * against the importer's own directory, exactly as a direct check would) is expressed package-
 * relative and matched against each projection's `to` prefix; the matched remainder is replaced
 * onto `from` and checked on disk the same way a direct relative import would be, plus once more
 * with a trailing source extension stripped -- a served file is always named with its served
 * extension (typically .js), which can differ from its real source extension (.mjs, .mts, ...).
 */
export function resolvesThroughServedProjection(root, packageDirectory, targetAbsolute) {
  const servedProjections = servedProjectionsOf(root, packageDirectory);
  if (servedProjections.length === 0) return false;
  const packageAbsolute = resolve(root, packageDirectory);
  const targetPackageRelative = relative(packageAbsolute, targetAbsolute).split("\\").join("/");
  if (targetPackageRelative.startsWith("..")) return false; // outside the package: no projection of this package's own reaches it
  for (const projection of servedProjections) {
    const from = projection?.from;
    const to = projection?.to;
    if (typeof from !== "string" || typeof to !== "string") continue;
    let remainder;
    if (targetPackageRelative === to) remainder = "";
    else if (targetPackageRelative.startsWith(`${to}/`)) remainder = targetPackageRelative.slice(to.length);
    else continue;
    const candidateBase = join(packageAbsolute, `${from}${remainder}`);
    if (resolvesToFile(candidateBase)) return true;
    const withoutExtension = candidateBase.replace(SOURCE, "");
    if (withoutExtension !== candidateBase && resolvesToFile(withoutExtension)) return true;
  }
  return false;
}

/**
 * Classifies one specifier written by `importerRelativePath`: undefined when it is not a house
 * specifier or a relative specifier (nothing to check), otherwise a PhantomImportFinding without
 * the `importer` field. `packageDirectory`, when given, is the importer's own owning package
 * directory: a relative specifier that does not resolve directly is checked once more against that
 * package's declared servedProjections before it is called phantom.
 *
 * `heldAreas`, when given, downgrades what would otherwise be a "no-file" finding to
 * "held-untracked" when the importer or the resolved target lies in one of its areas: at a ref
 * export, another hand's own untracked, uncommitted file is simply absent, which looks exactly like
 * a broken import unless the held-areas record says whose in-flight work this is.
 */
export function classifySpecifier(specifier, importerRelativePath, root, map, packageDirectory, heldAreas) {
  const heldPatterns = heldAreaPatterns(heldAreas);
  if (specifier.startsWith(".")) {
    const base = resolve(root, dirname(importerRelativePath), specifier);
    if (resolvesToFile(base)) return undefined;
    if (packageDirectory !== undefined && resolvesThroughServedProjection(root, packageDirectory, base)) return undefined;
    const targetRelative = relative(root, base).split("\\").join("/");
    if (inHeldArea(importerRelativePath, heldPatterns) || inHeldArea(targetRelative, heldPatterns)) return { specifier, cause: "held-untracked" };
    return { specifier, cause: "no-file" };
  }
  if (!HOUSE_SCOPE.test(specifier)) return undefined;
  const parts = specifier.split("/");
  const name = parts.slice(0, 2).join("/");
  const directory = map.packages[name];
  if (directory === undefined) return { specifier, cause: "no-package" };
  const subpath = parts.slice(2).join("/");
  if (subpath === "") return undefined;
  let packageJson;
  try { packageJson = JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8")); } catch { packageJson = {}; }
  if (packageJson.exports && typeof packageJson.exports === "object") {
    return exportsSubpath(packageJson.exports, subpath) ? undefined : { specifier, cause: "no-export", package: name };
  }
  const base = join(root, directory, subpath);
  if (resolvesToFile(base)) return undefined;
  if (inHeldArea(importerRelativePath, heldPatterns) || inHeldArea(`${directory}/${subpath}`, heldPatterns)) return { specifier, cause: "held-untracked", package: name };
  return { specifier, cause: "no-file", package: name };
}

/** Audits an explicit list of repository-relative files for phantom imports. */
export function auditPhantomImportsForFiles({ root, map, files, heldAreas }) {
  const findings = [];
  const directories = new Set(Object.values(map.packages));
  const reverse = new Map(Object.entries(map.packages).map(([name, directory]) => [directory, name]));
  const byCause = {};
  const byPackage = {};
  for (const importerRelative of files) {
    let text;
    try { text = readFileSync(join(root, importerRelative), "utf8"); } catch { continue; }
    const owner = owningPackage(importerRelative, directories);
    const importingPackage = owner ? (reverse.get(owner) ?? owner) : "(none)";
    for (const match of stripCommentsAndLiterals(text).matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
      const classified = classifySpecifier(specifier, importerRelative, root, map, owner, heldAreas);
      if (classified === undefined) continue;
      const finding = { importer: importerRelative, specifier: classified.specifier, cause: classified.cause };
      if (classified.package) finding.package = classified.package;
      findings.push(finding);
      byCause[finding.cause] = (byCause[finding.cause] ?? 0) + 1;
      byPackage[importingPackage] = (byPackage[importingPackage] ?? 0) + 1;
    }
  }
  return { findings, census: { byCause, byPackage } };
}

/**
 * Audits every source file under `walkRoots` (default lib and dev) for phantom imports; test files
 * are skipped unless `includeTests`. With `ref`, audits a read-only export of that ref instead of the
 * working tree (see exportHouseTreeAtRef); `refCache`, when given, is shared with sibling calls at
 * the same ref (the caller owns tearing it down), and without one this call exports and cleans up its
 * own. A ref or directory absent at that ref reports no findings at all, the same shape as an empty
 * tree; a `walkRoot` not under the export (only "dev", by default) simply contributes nothing.
 * `heldAreas`, when given, is threaded to classifySpecifier so a "no-file" finding whose importer or
 * target lies in a held area is reported as "held-untracked" instead (see classifySpecifier).
 */
export function auditPhantomImports({ root, map, walkRoots = WALK_ROOTS, includeTests = false, ref, refCache, heldAreas }) {
  let effectiveRoot = root;
  let cleanup;
  if (ref) {
    const ownCache = refCache ?? new Map();
    effectiveRoot = exportHouseTreeAtRef(root, ref, { cache: ownCache });
    if (effectiveRoot === undefined) return { findings: [], census: { byCause: {}, byPackage: {} } };
    if (!refCache) cleanup = () => { for (const dir of ownCache.values()) if (dir) rmSync(dir, { recursive: true, force: true }); };
  }
  try {
    const files = [];
    for (const walkRoot of walkRoots) {
      for (const file of walk(resolve(effectiveRoot, walkRoot))) {
        const relativePath = relative(effectiveRoot, file).split("\\").join("/");
        if (!includeTests && (TEST_FILE.test(relativePath) || TEST_DIRECTORY.test(relativePath))) continue;
        files.push(relativePath);
      }
    }
    return auditPhantomImportsForFiles({ root: effectiveRoot, map, files, heldAreas });
  } finally {
    if (cleanup) cleanup();
  }
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const root = resolve(argument("--root", args) || process.cwd());
  const here = dirname(new URL(import.meta.url).pathname);
  const map = discoverHousePackages(root);
  const heldAreas = readHeldAreas(argument("--held-areas", args) || join(here, "../data/records/house-held-areas.json"));
  const packageDir = argument("--package", args);
  const report = auditPhantomImports({ root, map, walkRoots: packageDir ? [packageDir] : WALK_ROOTS, includeTests: args.includes("--include-tests"), ref: argument("--ref", args), heldAreas });
  process.stdout.write(`${JSON.stringify(args.includes("--summary") ? { findings: report.findings.length, census: report.census } : report, null, 2)}\n`);
}
