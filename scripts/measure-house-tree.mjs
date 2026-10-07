#!/usr/bin/env node
// Measures the house codebase at a git ref by the 2026-09-21 baseline method: the packages in the
// packages discovered from manifests at that ref; their .mjs/.js/.cjs and .ts/.mts/.cts sources under src, scripts,
// apps and lib (nested services, node_modules and dist excluded); every file counts once, for the
// deepest package that holds it; lines counted from the committed blobs, so uncommitted work never
// leaks into the number. Objectively-less-code is judged on this, at the same ref, by this method.
//
// Alongside that count, one call now also reports the norms the house's own tooling tracks, all
// computed against a single read-only export of the ref (see exportHouseTreeAtRef; no worktree, no
// checkout): the layer audit's findings, the phantom-import audit's findings, the hull/kernel
// audit's findings, and — from the manifest reviewer's own tree run
// (javascript-normalization-services-section) — its "barrel" deviation count and its cross-package
// relative-import deviation count ("relative-import-outside-package" plus
// "relative-import-into-nested-package"). The reviewer names house-scoped packages by bare
// specifier, so it runs as its own child process with the house resolver on NODE_OPTIONS for that
// process alone; this script's own in-process audits need no such thing, which keeps
// owningPackage/sourceKind/countLines — imported by other scripts from this same module — free of
// that dependency. The ref or its layers record being unavailable there skips every added field (a
// `note` says so); the reviewer's own run alone taking longer than REVIEW_TOO_SLOW_MS instead skips
// just its two fields, `note` naming how long the run actually took.
//
//   node measure-house-tree.mjs [--ref HEAD] [--repository /path/to/repo]
//
// Prints one JSON record: { ref, packages, jsFiles, jsLines, tsFiles, tsLines, oneFilePackages,
// layerFindings, phantomFindings, hullKernelFindings, barrels, crossPackageRelativeImports, note? } —
// the six norm fields present only when the ref's tree could be exported, the last two of them only
// when the reviewer's own run also finished inside REVIEW_TOO_SLOW_MS.
import { execFileSync, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { auditHullKernel } from "./audit-hull-kernel.mjs";
import { auditLayerImports } from "./audit-layer-imports.mjs";
import { auditPhantomImports } from "./audit-phantom-imports.mjs";
import { exportHouseTreeAtRef, HOUSE_TREE_DIRECTORY } from "./export-house-tree-at-ref.mjs";
import { argument } from "../src/argv.mjs";
import { discoverHousePackages } from "../src/discover-house-packages.mjs";

const LAYERS_SUFFIX = "javascript-node-services-section/data/records/house-layers.json";
const COUNTED = /^(src|scripts|apps|lib)\//u;
const EXCLUDED = /\/(node_modules|dist|services)\//u;
export const REVIEW_TOO_SLOW_MS = 120_000;

function git(repository, args, input) {
  return execFileSync("/usr/bin/git", args, { cwd: repository, encoding: "utf8", maxBuffer: 1 << 30, input });
}

/** Classifies one path inside a package as a JavaScript or TypeScript source, or neither. */
export function sourceKind(tail) {
  if (!COUNTED.test(tail) || EXCLUDED.test(`/${tail}`)) return undefined;
  if (/\.(mjs|cjs|js)$/u.test(tail)) return "js";
  if (/\.(ts|mts|cts)$/u.test(tail) && !/\.d\.(ts|mts|cts)$/u.test(tail)) return "ts";
  return undefined;
}

/** The deepest package directory that holds a path, so a file counts once even under nested packages. */
export function owningPackage(path, directories) {
  let directory = path;
  while (true) {
    const cut = directory.lastIndexOf("/");
    if (cut < 0) return undefined;
    directory = directory.slice(0, cut);
    if (directories.has(directory)) return directory;
  }
}

/** Counts lines in a blob the way wc -l plus one does for a final unterminated line. */
export function countLines(bytes) {
  let lines = 1;
  for (const byte of bytes) if (byte === 10) lines++;
  return lines;
}

/**
 * The manifest reviewer's own tree run (javascript-normalization-services-section), against the tree
 * already exported at `treeRoot`, run as its own child process (the house resolver on NODE_OPTIONS
 * for that process alone, since the reviewer names house-scoped packages by bare specifier) rather
 * than imported in-process, so a caller of this module that only wants owningPackage/sourceKind/
 * countLines never pays for that dependency. The reviewer discovers the exported ref's manifests
 * directly. Returns its "barrel" and cross-package relative-import ("relative-import-outside-package"
 * plus "relative-import-into-nested-package") deviation counts, or, when the run does not finish
 * inside `timeoutMs` (default REVIEW_TOO_SLOW_MS; or its output cannot be read), `detail` naming why
 * instead. Exported so its own timeout behaviour is directly testable without waiting out the real
 * default.
 */
export function measureReviewer(here, treeRoot, { timeoutMs = REVIEW_TOO_SLOW_MS } = {}) {
  const reviewerScriptPath = join(here, "../../javascript-normalization-services-section/scripts/review-jsnode-package.mjs");
  const resolverImportPath = join(here, "register-house-resolver.mjs");
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [reviewerScriptPath, "--all", "--root", treeRoot, "--summary"], {
    env: { ...process.env, NODE_OPTIONS: `--import ${resolverImportPath}` },
    encoding: "utf8",
    maxBuffer: 1 << 28,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  const elapsedMs = Date.now() - startedAt;
  // A normal run with findings (virtually always, on the real tree) exits 2 by this CLI's own
  // design, not 0 — only a timeout or a signal means the run itself did not finish.
  if (result.error?.code === "ETIMEDOUT" || (result.signal && result.error)) return { elapsedMs, detail: `timed out after ${timeoutMs}ms` };
  let summary;
  try { summary = JSON.parse(result.stdout); } catch { return { elapsedMs, detail: `reviewer output was not JSON: ${(result.stderr || result.stdout || "").slice(0, 300)}` }; }
  const census = summary.census ?? {};
  const barrels = census.barrel ?? 0;
  const crossPackageRelativeImports = (census["relative-import-outside-package"] ?? 0) + (census["relative-import-into-nested-package"] ?? 0);
  return { elapsedMs, barrels, crossPackageRelativeImports };
}

/**
 * The norm counts the house's own tooling now tracks, computed against a single read-only export of
 * `ref` (shared by every audit here; see exportHouseTreeAtRef): the layer audit's findings, the
 * phantom-import audit's findings, the hull/kernel audit's findings, and the reviewer's barrel and
 * cross-package relative-import deviation counts (see measureReviewer). `{ note }` alone when `ref`'s
 * own layers record, or HOUSE_TREE_DIRECTORY itself, is not available there — the fixture repositories
 * measure-house-tree's own tests use, rooted outside HOUSE_TREE_DIRECTORY, take this path, the same
 * one a ref genuinely missing the tree would. The reviewer's two fields specifically are left out
 * (with a `note` naming how long its run actually took) when it does not finish in time.
 */
function measureNorms({ repository, ref, layersPath }) {
  if (layersPath === undefined) return { note: `no house-layers.json under lib at ${ref}; norm counts skipped` };
  const layers = JSON.parse(git(repository, ["show", `${ref}:${layersPath}`]));
  const refCache = new Map();
  const treeRoot = exportHouseTreeAtRef(repository, ref, { cache: refCache });
  if (treeRoot === undefined) return { note: `${HOUSE_TREE_DIRECTORY} not found at ${ref}; norm counts skipped` };
  try {
    const map = discoverHousePackages(treeRoot);
    return {
      layerFindings: auditLayerImports({ root: treeRoot, layers, map }).findings.length,
      phantomFindings: auditPhantomImports({ root: treeRoot, map }).findings.length,
      hullKernelFindings: auditHullKernel({ root: treeRoot, map }).findings.length,
    };
  } finally {
    for (const dir of refCache.values()) if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** Measures the tracked tree at `ref` of `repository`. */
export function measureHouseTree({ ref = "HEAD", repository = process.cwd() } = {}) {
  const treeEntries = git(repository, ["ls-tree", "-r", "-z", ref, "--", "lib"]).split("\0").filter(Boolean).map((line) => {
    const [meta, path] = line.split("\t");
    return { oid: meta.split(" ")[2], path };
  });
  const byPath = new Map(treeEntries.map((entry) => [entry.path, entry.oid]));
  const directories = new Set(treeEntries.filter((entry) => entry.path.endsWith("/package.json")).map((entry) => dirname(entry.path)));
  const own = new Map([...directories].map((directory) => [directory, 0]));
  const wanted = [];
  for (const [path, oid] of byPath) {
    const owner = owningPackage(path, directories);
    if (owner === undefined) continue;
    const kind = sourceKind(path.slice(owner.length + 1));
    if (kind === undefined) continue;
    wanted.push({ oid, kind });
    own.set(owner, own.get(owner) + 1);
  }
  const packages = directories.size;
  const oneFilePackages = [...own.values()].filter((count) => count === 1).length;
  const batch = spawnSync("/usr/bin/git", ["cat-file", "--batch"], { cwd: repository, input: `${wanted.map((entry) => entry.oid).join("\n")}\n`, maxBuffer: 1 << 30 });
  if (batch.status !== 0) throw new Error(batch.stderr.toString());
  const out = batch.stdout;
  const counts = { js: { files: 0, lines: 0 }, ts: { files: 0, lines: 0 } };
  let position = 0;
  for (const { kind } of wanted) {
    const newline = out.indexOf(10, position);
    const size = Number(out.subarray(position, newline).toString().split(" ")[2]);
    counts[kind].files++;
    counts[kind].lines += countLines(out.subarray(newline + 1, newline + 1 + size));
    position = newline + 1 + size + 1;
  }
  const layersPath = treeEntries.find((entry) => entry.path.endsWith(LAYERS_SUFFIX))?.path;
  const norms = measureNorms({ repository, ref, layersPath });
  return { ref, packages, jsFiles: counts.js.files, jsLines: counts.js.lines, tsFiles: counts.ts.files, tsLines: counts.ts.lines, oneFilePackages, ...norms };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  process.stdout.write(`${JSON.stringify(measureHouseTree({ ref: argument("--ref", args) || "HEAD", repository: argument("--repository", args) || process.cwd() }))}\n`);
}
