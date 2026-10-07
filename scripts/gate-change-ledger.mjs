#!/usr/bin/env node
// The engineer's one gate before the commit operator runs: verify the ledger, screen it, audit the
// whole tree's layer imports and phantom imports (compared against a baseline: a stored directory
// when --baseline names one, otherwise both audits computed live against `ref`, default HEAD, the
// same way the suite baseline already was, so a bare gate run needs no hand-refreshed baseline
// directory to tell pre-existing debt from a new regression), audit the kept files for a newly
// introduced external dependency, count any TypeScript still present among the kept files (a kept
// path that no longer exists in the working tree — a deleted .mts, say — does not count), and run
// the ledger's owning packages' suites now against those same packages exported read-only at `ref` —
// a package the baseline directory never happened to cover is not simply absent (which used to make
// every one of its failures look "new"); a package that did not exist at the ref gets an empty
// baseline instead. Before the external-import and TypeScript checks, a kept path absent at HEAD is
// tested for being a move (its content hash equals a HEAD blob at another path, under one of the
// ledger's own packages or at a path the ledger deletes) or a translation (a kept .mjs absent at HEAD
// whose basename with .mts/.cts/.ts was tracked at HEAD in the same directory, a translation's bytes
// having changed so no hash match is possible) — either way the file's externals are judged against
// that origin's HEAD content instead of an absent new name's, which otherwise makes every import the
// file already had look newly added. The gate also lists, per owning package, any untracked
// non-ignored source file the ledger omits that a tracked file already names by basename — a commit
// built from such a ledger ships code that imports a file nobody `git add`ed; a path in a held area,
// or that belongs to a nested package (a directory under the owning package with its own
// package.json) the ledger does not itself own, is not this ledger's business and is excluded first.
// The verdict is false when this run adds a layer finding, a phantom, an external import, a
// TypeScript file, a test failure the ref did not have, or an omitted untracked file that some
// tracked file already reaches for — but only when that finding is *attributed* to this ledger: its
// importer (or failing file) is one of the ledger's own kept paths, lies under one of the packages
// screen.kept actually touches right now (not every package the ledger's raw entries ever named —
// see attributedPackageDirs below, a re-committed or stale ledger owns nothing live), or its
// specifier resolves into a path the ledger itself deletes or renames. Because the layer and phantom
// audits run tree-wide and the baseline is a ref (not this run's own working tree), another writer's
// own in-flight edit elsewhere in the tree — or Codex's untracked area — can add a "new" finding
// that has nothing to do with this ledger; that finding is still computed and reported in full,
// under `elsewhere` (with a one-line count per kind), but it is never counted toward `ok`.
// `newLayerFindings`, `newPhantoms`, `newExternals`, and `suites.newFailures` hold only the
// attributed findings the verdict is actually judged by.
//
//   node gate-change-ledger.mjs --ledger <file> [--root /home/emsenn/info] [--baseline <dir>] [--ref <git ref>]
//   node gate-change-ledger.mjs --ledger <file> [--root /home/emsenn/info] --write-baseline <dir>
//
// The verdict (or, in --write-baseline mode, a small receipt) prints as JSON to stdout; exit 1 when
// the verdict is not ok.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { auditLayerImports, resolveSpecifier } from "./audit-layer-imports.mjs";
import { auditPhantomImports } from "./audit-phantom-imports.mjs";
import { auditExternalImports } from "./audit-external-imports.mjs";
import {
  classifyChangeState, expandEntries, git, gitShowBuffer, nestedPackageOwner, omittedUntrackedFiles, readHeldAreas, readLedgerEntries, screenChangeLedger,
} from "./screen-change-ledger.mjs";
import { verifyChangeLedger } from "./verify-change-ledger.mjs";
import { packagesForLedger, packagesForPaths, runPackageSuites } from "./run-package-suites.mjs";
import { argument } from "../src/argv.mjs";
import { discoverHousePackages } from "../src/discover-house-packages.mjs";

const TYPESCRIPT_SOURCE = /\.(ts|mts|cts)$/u;
const TYPESCRIPT_DECLARATION = /\.d\.(ts|mts|cts)$/u;

function findingKey(finding) { return JSON.stringify(finding); }

/** The HEAD blob hash for every file `git ls-tree -r` finds under `directory`. */
function headBlobsUnder(root, directory) {
  const result = git(root, ["ls-tree", "-r", "HEAD", "--", directory]);
  if (result.status !== 0) return [];
  return result.stdout.toString("utf8").split("\n").filter(Boolean).map((line) => {
    const [meta, path] = line.split("\t");
    return { sha: meta.split(" ")[2], path };
  });
}

/** The HEAD blob hash for one tracked path, or undefined when git cannot find it. */
function headBlobAt(root, path) {
  const result = git(root, ["ls-tree", "HEAD", "--", path]);
  const line = result.status === 0 ? result.stdout.toString("utf8").split("\n").find(Boolean) : undefined;
  return line ? line.split("\t")[0].split(" ")[2] : undefined;
}

/** The git blob hash of a path's current on-disk content, computed the same way a committed blob would hash (`git hash-object`), so it can be matched against a HEAD blob map without git having ever seen this content. */
function blobShaOnDisk(root, path) {
  const result = git(root, ["hash-object", "--", path]);
  return result.status === 0 ? result.stdout.toString("utf8").trim() : undefined;
}

/**
 * Detects a kept path that is a move: absent at HEAD under its own name (a fresh write there would
 * also look this way, which is why only a byte-identical match to a known HEAD blob counts) but
 * byte-identical to a HEAD blob either under one of the ledger's own packages or at a path the
 * ledger deletes. A moved-not-edited file's externals and TypeScript-ness should be judged against
 * that origin's HEAD content, not against the empty HEAD content an absent new name has.
 * @returns {Map<string, string>} kept path -> origin path, for paths detected as moved.
 */
export function detectMoves({ root, kept, packageDirs, deletedPaths }) {
  const headBlobs = new Map();
  for (const packageDir of packageDirs) for (const { sha, path } of headBlobsUnder(root, packageDir)) if (!headBlobs.has(sha)) headBlobs.set(sha, path);
  for (const path of deletedPaths) {
    const sha = headBlobAt(root, path);
    if (sha !== undefined && !headBlobs.has(sha)) headBlobs.set(sha, path);
  }
  const moves = new Map();
  for (const path of kept) {
    if (gitShowBuffer(root, `HEAD:${path}`) !== undefined) continue; // tracked at this same path already: not a move
    const sha = blobShaOnDisk(root, path);
    if (sha === undefined) continue;
    const origin = headBlobs.get(sha);
    if (origin !== undefined && origin !== path) moves.set(path, origin);
  }
  return moves;
}

const TRANSLATION_ORIGIN_SUFFIXES = Object.freeze([".mts", ".cts", ".ts"]);

/**
 * Detects a kept ".mjs" path that is a translation: new (no HEAD blob at this path, unlike a move,
 * whose content is byte-identical to some HEAD blob elsewhere) whose basename, with ".mts" (or
 * ".cts"/".ts") in place of ".mjs", was tracked at HEAD in that same directory. Translating a
 * TypeScript source into plain JavaScript changes its bytes (types stripped, syntax rewritten), so
 * detectMoves' byte-identical match never finds it; this instead goes by name and place, the way a
 * writer reads "foo.mts became foo.mjs". A translation's externals should be judged against that
 * origin's HEAD content, not against the empty HEAD content a brand-new path has, the same as a
 * moved file's are.
 * @returns {Map<string, string>} kept .mjs path -> origin .mts/.cts/.ts path, for paths detected as translations.
 */
export function detectTranslations({ root, kept }) {
  const translations = new Map();
  for (const path of kept) {
    if (!path.endsWith(".mjs")) continue;
    if (gitShowBuffer(root, `HEAD:${path}`) !== undefined) continue; // already tracked at this same path: not a fresh translation
    const base = path.slice(0, -".mjs".length);
    for (const suffix of TRANSLATION_ORIGIN_SUFFIXES) {
      const origin = `${base}${suffix}`;
      if (gitShowBuffer(root, `HEAD:${origin}`) !== undefined) { translations.set(path, origin); break; }
    }
  }
  return translations;
}

/** The findings present in `current` that are not present in `baseline` (identical records, in any order). */
export function newFindings(current, baseline = []) {
  const baselineKeys = new Set(baseline.map(findingKey));
  return current.filter((finding) => !baselineKeys.has(findingKey(finding)));
}

// A specifier resolved to a repository path (resolveSpecifier) never carries an extension a house
// subpath omitted; a deleted or renamed path on the ledger always is a real file, extension and
// all. These are tried in order against a resolved base before giving up on a match, the same
// candidate shape audit-phantom-imports' own FILE_SUFFIXES checks on disk.
const ATTRIBUTION_TARGET_SUFFIXES = Object.freeze(["", ".mjs", ".cjs", ".js", ".mts", ".cts", ".ts", "/index.mjs"]);

/**
 * True when `path` is one of `packageDirs` itself or sits under one of them — but not when it sits
 * under a *nested* package inside one (a directory with its own package.json, the same exclusion
 * omittedUntrackedFiles already applies) unless that nested package is itself one of `packageDirs`.
 * Without this, any path anywhere under a ledger's own package directory — including a wholly
 * separate, nested section another hand owns, a held area among them — would count as this ledger's
 * own business merely by sharing a directory prefix.
 */
function underAnyPackage(path, packageDirs, root) {
  const packageSet = new Set(packageDirs);
  for (const dir of packageDirs) {
    if (path === dir) return true;
    if (!path.startsWith(`${dir}/`)) continue;
    const nestedOwner = nestedPackageOwner(path, dir, root);
    if (nestedOwner === undefined || packageSet.has(nestedOwner)) return true;
  }
  return false;
}

/**
 * True when a finding's resolved specifier target names a path the ledger itself deletes or renames
 * away from — an import elsewhere in the tree that reached for a file this ledger removed, so the
 * break is this ledger's doing even though the importer sits outside its own packages.
 */
function targetsRenamedOrDeleted(targetBase, renamedOrDeleted) {
  return targetBase !== undefined && ATTRIBUTION_TARGET_SUFFIXES.some((suffix) => renamedOrDeleted.has(`${targetBase}${suffix}`));
}

/**
 * Partitions `findings` (each carrying an `importer`, `path`, or `file` field naming the
 * repository-relative file responsible) into `attributed` — this ledger's own business — and
 * `elsewhere` — everything else, still returned in full but excluded from the gate's own verdict.
 * A finding is attributed when its importer/failing file is one of the ledger's own `kept` paths,
 * lies under one of its `packageDirs` (excluding a nested package inside one that `packageDirs`
 * does not itself own — see underAnyPackage), or (via `resolveTarget`, when given) its specifier
 * resolves into a path in `renamedOrDeleted` — a file the ledger itself deleted or renamed away
 * from, still reached for by an importer elsewhere in the tree. `root` is only consulted for the
 * nested-package check, so callers whose findings never share a package-directory prefix (the
 * `partitionByAttribution` unit tests below among them) may omit it.
 */
export function partitionByAttribution(findings, { kept, packageDirs, root, renamedOrDeleted = new Set(), resolveTarget }) {
  const keptSet = new Set(kept);
  const attributed = [];
  const elsewhere = [];
  for (const finding of findings) {
    const importer = finding.importer ?? finding.path ?? finding.file;
    const byImporter = importer !== undefined && (keptSet.has(importer) || underAnyPackage(importer, packageDirs, root));
    const byTarget = !byImporter && resolveTarget !== undefined && targetsRenamedOrDeleted(resolveTarget(finding), renamedOrDeleted);
    (byImporter || byTarget ? attributed : elsewhere).push(finding);
  }
  return { attributed, elsewhere };
}

function failureKey(failure) { return `${failure.file}|${failure.cause}`; }

/** Per package present in `current`: the failures new since `baseline`, the failures `baseline` had that are gone now, and the failures present on both sides. */
export function diffSuites(current, baseline = []) {
  const baselineByPackage = new Map(baseline.map((report) => [report.package, report]));
  const newFailures = [];
  const fixed = [];
  const unchanged = [];
  for (const report of current) {
    const before = baselineByPackage.get(report.package);
    const beforeKeys = new Set((before?.failures ?? []).map(failureKey));
    const afterKeys = new Set(report.failures.map(failureKey));
    for (const failure of report.failures) (beforeKeys.has(failureKey(failure)) ? unchanged : newFailures).push({ package: report.package, ...failure });
    for (const failure of before?.failures ?? []) if (!afterKeys.has(failureKey(failure))) fixed.push({ package: report.package, ...failure });
  }
  return { newFailures, fixed, unchanged };
}

/**
 * The external-import findings newly present in a kept file's current text that were not present at
 * HEAD (or the whole file is new). `originPath` (set for a detected move) is compared against
 * instead of `path` itself, since a moved file has no HEAD blob at `path` to compare against.
 */
export function newExternalFindings(path, root, originPath) {
  let currentText;
  try { currentText = readFileSync(join(root, path), "utf8"); } catch { return []; }
  const after = auditExternalImports({ path, text: currentText }).findings;
  const beforeBuffer = gitShowBuffer(root, `HEAD:${originPath ?? path}`);
  const beforeSpecifiers = beforeBuffer ? new Set(auditExternalImports({ path, text: beforeBuffer.toString("utf8") }).findings.map((finding) => finding.specifier)) : new Set();
  return after.filter((finding) => !beforeSpecifiers.has(finding.specifier)).map((finding) => ({ path, ...finding }));
}

/** Writes the tree-wide baseline (the layer audit and the phantom audit only) a later gate compares against; the suite baseline is instead computed live, per gate run, from the ledger's own ref. */
export function writeBaseline({ root, layers, map, dir }) {
  mkdirSync(dir, { recursive: true });
  const layerReport = auditLayerImports({ root, layers, map });
  const phantomReport = auditPhantomImports({ root, map });
  writeFileSync(join(dir, "layer-audit.json"), `${JSON.stringify(layerReport, null, 2)}\n`);
  writeFileSync(join(dir, "phantom-imports.json"), `${JSON.stringify(phantomReport, null, 2)}\n`);
  return { dir, layerFindings: layerReport.findings.length, phantomFindings: phantomReport.findings.length };
}

/**
 * The layer/phantom baseline: read from the stored `dir` when one is given, otherwise computed live
 * — the tree-wide layer and phantom audits run against a read-only export of `ref` (default "HEAD"),
 * the same "compute it from history" approach the suite baseline already used — so a bare gate run
 * needs no hand-refreshed baseline directory to tell pre-existing debt from a new regression. Both
 * audits share one ref export for this call (see exportHouseTreeAtRef), torn down before returning.
 * `heldAreas`, threaded to the phantom audit, keeps a held area's own untracked file from looking
 * like a broken import merely because the ref export never had it (see audit-phantom-imports.mjs).
 */
function resolveBaseline({ root, layers, map, heldAreas, dir, ref }) {
  if (dir) {
    return {
      layerFindings: JSON.parse(readFileSync(join(dir, "layer-audit.json"), "utf8")).findings,
      phantomFindings: JSON.parse(readFileSync(join(dir, "phantom-imports.json"), "utf8")).findings,
    };
  }
  const refCache = new Map();
  try {
    return {
      layerFindings: auditLayerImports({ root, layers, map, ref, refCache }).findings,
      phantomFindings: auditPhantomImports({ root, map, heldAreas, ref, refCache }).findings,
    };
  } finally {
    for (const exported of refCache.values()) if (exported) rmSync(exported, { recursive: true, force: true });
  }
}

/**
 * The full gate: verify, screen, the tree-wide layer and phantom audits against the baseline
 * (a stored directory with --baseline, otherwise computed live at `ref`), the kept files'
 * external-import and TypeScript census, and the ledger's packages' suites now against those same
 * packages exported read-only at `ref` (default "HEAD") — so a package the baseline directory never
 * covered still gets a real (if empty, for a package new since that ref) comparison instead of
 * counting every one of its failures as new.
 *
 * Every new finding (layer, phantom, external, suite failure) is then partitioned into `attributed`
 * — this ledger's own business, judged by `ok` — and `elsewhere`: drift the tree-wide audits and the
 * ledger-scoped suite run still surface, from a file this ledger never touched and does not own, kept
 * in full under `elsewhere` so the engineer can see it without it ever failing this ledger's own gate
 * (see partitionByAttribution).
 */
export function gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir, resolverImportPath, ref = "HEAD" }) {
  const verify = verifyChangeLedger({ ledgerFile, root, map, heldAreas });
  const screen = screenChangeLedger({ ledgerFile, root, allow: [], heldAreas });
  const baseline = resolveBaseline({ root, layers, map, heldAreas, dir: baselineDir, ref });

  const packageDirsRelative = packagesForLedger(ledgerFile, root, map);
  const expandedLedgerPaths = expandEntries(readLedgerEntries(ledgerFile, root), root);
  const deletedPaths = expandedLedgerPaths.filter((path) => classifyChangeState(path, root) === "deleted");
  const movesByPath = detectMoves({ root, kept: screen.kept, packageDirs: packageDirsRelative, deletedPaths });
  const moved = [...movesByPath].map(([to, from]) => ({ from, to }));

  const translationsByPath = detectTranslations({ root, kept: screen.kept });
  const translated = [...translationsByPath].map(([to, from]) => ({ from, to }));

  // Everything a specifier elsewhere in the tree could still be reaching for that this ledger itself
  // made gone: a deleted path outright, or the old name on either side of a detected move/translation.
  const renamedOrDeleted = new Set([...deletedPaths, ...moved.map((entry) => entry.from), ...translated.map((entry) => entry.from)]);
  // Attribution's own "owning packages" are the packages screen.kept actually touches right now —
  // not packageDirsRelative's (every package the ledger's raw entries ever named, used to decide
  // which suites to run at all). A ledger whose every entry is already byte-identical to HEAD (one
  // already committed, re-run only to watch the tree) keeps naming those same packages for
  // packageDirsRelative — suites still run there — but owns none of them live: kept is empty, so
  // nothing found inside them is this run's own doing, and a package the ledger merely mentions in
  // passing never attributes a stranger's drift to it.
  const attributedPackageDirs = packagesForPaths(screen.kept, map);
  const attributionBase = { kept: screen.kept, packageDirs: attributedPackageDirs, root, renamedOrDeleted };
  const resolveHouseTarget = (finding) => resolveSpecifier(finding.specifier, finding.importer, map);

  const layerReport = auditLayerImports({ root, layers, map });
  const layerPartition = partitionByAttribution(newFindings(layerReport.findings, baseline.layerFindings), { ...attributionBase, resolveTarget: resolveHouseTarget });

  const phantomReport = auditPhantomImports({ root, map, heldAreas });
  const phantomPartition = partitionByAttribution(newFindings(phantomReport.findings, baseline.phantomFindings), { ...attributionBase, resolveTarget: resolveHouseTarget });

  const newExternalsAll = screen.kept.flatMap((path) => newExternalFindings(path, root, movesByPath.get(path) ?? translationsByPath.get(path)));
  // An external specifier (an npm package, not a house path) never resolves into a path this ledger
  // deletes or renames, so externals are attributed by importer alone: no resolveTarget here.
  const externalPartition = partitionByAttribution(newExternalsAll, attributionBase);

  // A deleted .mts/.cts/.ts path is still named on the ledger (it stays "kept" so its removal is
  // recorded), but nothing ships it: only a path that still exists in the working tree counts.
  const typescriptFiles = screen.kept.filter((path) => existsSync(join(root, path)) && TYPESCRIPT_SOURCE.test(path) && !TYPESCRIPT_DECLARATION.test(path));

  const omittedUntracked = omittedUntrackedFiles({ root, packages: packageDirsRelative, ledgerPaths: expandedLedgerPaths, heldAreas });

  const packageDirs = packageDirsRelative.map((directory) => join(root, directory));
  const currentSuites = runPackageSuites({ packages: packageDirs, root, heldAreas, resolverImportPath });
  const baselineSuites = runPackageSuites({ packages: packageDirs, root, heldAreas, resolverImportPath, ref });
  const suitesDiff = diffSuites(currentSuites, baselineSuites);
  const suitePartition = partitionByAttribution(suitesDiff.newFailures, attributionBase);

  const elsewhere = {
    layerFindings: layerPartition.elsewhere,
    phantoms: phantomPartition.elsewhere,
    externals: externalPartition.elsewhere,
    suiteFailures: suitePartition.elsewhere,
    summary: {
      layerFindings: layerPartition.elsewhere.length,
      phantoms: phantomPartition.elsewhere.length,
      externals: externalPartition.elsewhere.length,
      suiteFailures: suitePartition.elsewhere.length,
    },
  };

  const ok = layerPartition.attributed.length === 0 && phantomPartition.attributed.length === 0 && externalPartition.attributed.length === 0
    && typescriptFiles.length === 0 && suitePartition.attributed.length === 0 && omittedUntracked.every((entry) => entry.importedBy.length === 0);
  return {
    ok,
    verify,
    screen: screen.summary,
    newLayerFindings: layerPartition.attributed,
    newPhantoms: phantomPartition.attributed,
    newExternals: externalPartition.attributed,
    typescriptFiles,
    moved,
    translated,
    omittedUntracked,
    suites: { ...suitesDiff, newFailures: suitePartition.attributed },
    elsewhere,
  };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const root = resolve(argument("--root", args) || process.cwd());
  const here = dirname(new URL(import.meta.url).pathname);
  const layers = JSON.parse(readFileSync(join(here, "../data/records/house-layers.json"), "utf8"));
  const map = discoverHousePackages(root);
  const heldAreas = readHeldAreas(join(here, "../data/records/house-held-areas.json"));
  const resolverImportPath = join(here, "register-house-resolver.mjs");
  const ledgerFile = argument("--ledger", args);
  if (!ledgerFile) { process.stderr.write("usage: gate-change-ledger.mjs --ledger <file> [--root <repo>] [--baseline <dir> [--ref <git ref>] | --write-baseline <dir>]\n"); process.exit(2); }

  const writeBaselineDir = argument("--write-baseline", args);
  if (writeBaselineDir) {
    const receipt = writeBaseline({ root, layers, map, dir: resolve(writeBaselineDir) });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    process.exit(0);
  }

  const baselineOption = argument("--baseline", args);
  const verdict = gateChangeLedger({ root, layers, map, heldAreas, ledgerFile, baselineDir: baselineOption ? resolve(baselineOption) : undefined, resolverImportPath, ref: argument("--ref", args) || "HEAD" });
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  process.exitCode = verdict.ok ? 0 : 1;
}
