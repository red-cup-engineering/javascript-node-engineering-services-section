#!/usr/bin/env node
// Classifies every source module of every house package as kernel (touches an effectful
// capability) or hull (a pure transformation), per the Founder's 2026-09-21 ruling: "the software
// as essentially stratified layers of API, with the internal hull being the pure transformation
// functions and the external kernel being the effectful ones." A module is kernel when it imports
// an effectful Node builtin (EFFECTFUL_BUILTINS), imports `randomBytes` or `randomUUID` by name
// from node:crypto (EFFECTFUL_CRYPTO_NAMES; every other node:crypto use stays hull), reads
// process.env/argv/stdin/stdout/stderr, calls fetch(, calls Date.now( or `new Date()` with no
// argument, or calls Math.random(. Every other module is hull.
//
// Two findings: a hull module that imports a kernel module by a relative path -- its purity now
// depends on that effect, kind "hull-imports-kernel" -- and, informationally, a package whose
// entry export (package.json "." or an index file) is kernel while the package holds hull modules
// that the entry (the only thing outside callers can reach) never reaches, kind "entry-is-kernel".
//
// The classifier above only ever reads a module's own text: it marks kernel only by a direct
// effect marker in that module, so a hull module that composes an effect two or more relative-
// import hops away still classifies hull, and findings stay direct-marker-only (unchanged, by
// design -- see house-architecture-norms.json's hull-kernel norm). To keep that honest, every
// module's record in `modules` carries `reaches`: the shortest number of relative-import hops
// (within its own package only) from the module to a kernel module, 0 for kernel itself, absent
// when no such path exists (see computeReaches). Each package's census also carries the
// informational `hullReachingKernel` count: hull modules with reaches >= 2, i.e. hull modules that
// reach a kernel module only transitively, through another hull module -- not already visible as a
// "hull-imports-kernel" finding (that finding alone already covers reaches === 1).
//
//   node audit-hull-kernel.mjs [--root /home/emsenn/info] [--package <dir>] [--summary]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { SPECIFIER, stripCommentsAndLiterals } from "./audit-layer-imports.mjs";
import { resolveExports } from "../src/resolve-house-package.mjs";
import { discoverHousePackages } from "../src/discover-house-packages.mjs";
import { argument } from "../src/argv.mjs";

const SKIP = new Set(["node_modules", ".git", "dist", "legacy", ".tmp", ".cache", "coverage"]);
const SOURCE = /\.(mjs|cjs|js)$/u;
const TEST_FILE = /\.test\.(mjs|cjs|js)$/u;
const MODULE_DIRECTORIES = Object.freeze(["src", "scripts", "lib", "apps"]);
const FILE_SUFFIXES = Object.freeze(["", ".mjs", ".js", ".cjs", "/index.mjs", "/index.js", "/index.cjs"]);
const INDEX_CANDIDATES = Object.freeze(["index.mjs", "index.js", "index.cjs"]);

/** Node built-ins whose mere import makes a module effectful: the kernel side of the hull/kernel split. */
export const EFFECTFUL_BUILTINS = Object.freeze([
  "node:fs", "fs", "node:fs/promises", "node:child_process", "node:net", "node:http", "node:https",
  "node:http2", "node:dgram", "node:dns", "node:tls", "node:worker_threads", "node:cluster",
  "node:readline", "node:repl", "node:process", "node:os",
]);

/** node:crypto exports that are effectful (nondeterministic) only when imported or used by these names. */
export const EFFECTFUL_CRYPTO_NAMES = Object.freeze(["randomBytes", "randomUUID"]);

const PROCESS_STREAM = /\bprocess\.(env|argv|stdin|stdout|stderr)\b/gu;
const FETCH_CALL = /\bfetch\s*\(/u;
const DATE_NOW_CALL = /\bDate\.now\s*\(\s*\)/u;
const NEW_DATE_NO_ARG = /\bnew\s+Date\s*\(\s*\)/u;
const MATH_RANDOM_CALL = /\bMath\.random\s*\(/u;
const CRYPTO_NAMED_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\s*["']node:crypto["']/gu;
const CRYPTO_BINDING_IMPORT = /\bimport\s+(?:\*\s+as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))\s*from\s*["']node:crypto["']/gu;

function* walk(directory) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (existsSync(join(path, "package.json"))) continue; // a nested package: a separate audit target
      yield* walk(path);
    } else if (entry.isFile() && SOURCE.test(entry.name) && !TEST_FILE.test(entry.name)) yield path;
  }
}

/** The node:crypto effects a text actually uses: `randomBytes`/`randomUUID` named, or reached off a default/namespace binding. */
export function effectfulCryptoUses(text) {
  const found = new Set();
  for (const match of text.matchAll(CRYPTO_NAMED_IMPORT)) {
    const names = match[1].split(",").map((entry) => entry.trim().split(/\s+as\s+/u)[0].trim()).filter(Boolean);
    for (const name of EFFECTFUL_CRYPTO_NAMES) if (names.includes(name)) found.add(`node:crypto#${name}`);
  }
  for (const match of text.matchAll(CRYPTO_BINDING_IMPORT)) {
    const binding = match[1] ?? match[2];
    if (!binding) continue;
    for (const name of EFFECTFUL_CRYPTO_NAMES) {
      if (new RegExp(`\\b${binding}\\.${name}\\s*\\(`, "u").test(text)) found.add(`node:crypto#${name}`);
    }
  }
  return [...found];
}

/** Every effect reason found in one module's text, sorted and deduplicated; empty when the module is hull. */
export function effectsInText(text) {
  const effects = new Set();
  // A comment naming an effectful builtin -- prose, a JSDoc type reference, an old import kept as
  // an example -- never runs: only a real import can make a module kernel, so the specifier scan
  // (unlike the other effect checks below, which read the raw text) runs over stripped text.
  for (const match of stripCommentsAndLiterals(text).matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (EFFECTFUL_BUILTINS.includes(specifier)) effects.add(specifier);
  }
  for (const match of text.matchAll(PROCESS_STREAM)) effects.add(`process.${match[1]}`);
  if (FETCH_CALL.test(text)) effects.add("fetch");
  if (DATE_NOW_CALL.test(text)) effects.add("Date.now");
  if (NEW_DATE_NO_ARG.test(text)) effects.add("new Date()");
  if (MATH_RANDOM_CALL.test(text)) effects.add("Math.random");
  for (const cryptoEffect of effectfulCryptoUses(text)) effects.add(cryptoEffect);
  return [...effects].sort();
}

/** One module's classification: "kernel" with its effects, or "hull" with none. */
export function classifyModule(text) {
  const effects = effectsInText(text);
  return { kind: effects.length > 0 ? "kernel" : "hull", effects };
}

/** Resolves a relative specifier written by `importerRelativePath` to one of `candidates` (a Set of repository-relative paths), trying the same suffixes a bare extensionless specifier or a directory index would take. */
export function resolveRelativeModule(specifier, importerRelativePath, candidates) {
  if (!specifier.startsWith(".")) return undefined;
  const base = join(dirname(importerRelativePath), specifier).split("\\").join("/");
  for (const suffix of FILE_SUFFIXES) {
    const path = `${base}${suffix}`;
    if (candidates.has(path)) return path;
  }
  return undefined;
}

/** The package's entry file relative to its directory: package.json `exports["."]`, else `main`/`module`, else the first index file found; undefined when none resolves. */
export function packageEntryFile(manifest, packageDirectory) {
  if (manifest.exports !== undefined) {
    // Node ignores `main` and the implicit index once `exports` is present, even when
    // `exports` names no "." target -- the package then has no reachable entry at all.
    const fromExports = typeof manifest.exports === "string" ? manifest.exports : resolveExports(manifest.exports, ".");
    return typeof fromExports === "string" ? fromExports.replace(/^\.\//u, "") : undefined;
  }
  if (typeof manifest.module === "string") return manifest.module.replace(/^\.\//u, "");
  if (typeof manifest.main === "string") return manifest.main.replace(/^\.\//u, "");
  for (const candidate of INDEX_CANDIDATES) if (existsSync(join(packageDirectory, candidate))) return candidate;
  return undefined;
}

/** Every module reachable from `startPaths` by following relative imports through `modulesByPath`. */
function reachableFrom(startPaths, modulesByPath) {
  const seen = new Set();
  const queue = [...startPaths].filter((path) => modulesByPath.has(path));
  for (const path of queue) seen.add(path);
  while (queue.length > 0) {
    const path = queue.pop();
    const record = modulesByPath.get(path);
    // A comment or JSDoc type reference naming a relative path is not a real edge in the module
    // graph: reads record.strippedText (comments, regex literals, and non-import strings and
    // template literals already masked to spaces), the same text every SPECIFIER scan here reads.
    for (const match of record.strippedText.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
      const resolved = resolveRelativeModule(specifier, path, modulesByPath);
      if (resolved !== undefined && !seen.has(resolved)) { seen.add(resolved); queue.push(resolved); }
    }
  }
  return seen;
}

/**
 * The shortest number of relative-import hops from each module to a kernel module: 0 for a kernel
 * module itself, absent (no entry in the returned Map) for a module whose own relative imports
 * never reach one. A hull module a direct `hull-imports-kernel` finding already flags sits at 1; a
 * hull module that only composes another hull module which itself imports a kernel module sits at
 * 2 or more -- purity resting on an effect the direct-marker classifier alone cannot see. Only edges
 * within the same package are followed (`packageOfPath`), so a relative import that happened to
 * escape into another package never shortens another package's distance; a house-name (bare
 * specifier) import is never an edge here at all, same as everywhere else in this module.
 */
export function computeReaches(modulesByPath, packageOfPath) {
  const predecessorsOf = new Map();
  for (const [path, record] of modulesByPath) {
    for (const match of record.strippedText.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
      const resolved = resolveRelativeModule(specifier, path, modulesByPath);
      if (resolved === undefined || packageOfPath.get(resolved) !== packageOfPath.get(path)) continue;
      if (!predecessorsOf.has(resolved)) predecessorsOf.set(resolved, new Set());
      predecessorsOf.get(resolved).add(path);
    }
  }

  const reaches = new Map();
  const queue = [];
  for (const [path, record] of modulesByPath) {
    if (record.kind === "kernel") { reaches.set(path, 0); queue.push(path); }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const path = queue[head];
    const distance = reaches.get(path);
    for (const predecessor of predecessorsOf.get(path) ?? []) {
      if (reaches.has(predecessor)) continue;
      reaches.set(predecessor, distance + 1);
      queue.push(predecessor);
    }
  }
  return reaches;
}

/** Audits every source module of every package the map names (or, with `packageDirectory`, just the packages under it). */
export function auditHullKernel({ root, map, packageDirectory } = {}) {
  const wanted = packageDirectory === undefined
    ? Object.entries(map.packages)
    : Object.entries(map.packages).filter(([, directory]) => directory === packageDirectory || directory.startsWith(`${packageDirectory}/`));

  const modulesByPath = new Map();
  const packageOfPath = new Map();
  for (const [name, directory] of wanted) {
    for (const moduleDirectory of MODULE_DIRECTORIES) {
      for (const file of walk(resolve(root, directory, moduleDirectory))) {
        const relativePath = relative(root, file).split("\\").join("/");
        let text;
        try { text = readFileSync(file, "utf8"); } catch { continue; }
        const { kind, effects } = classifyModule(text);
        modulesByPath.set(relativePath, { text, strippedText: stripCommentsAndLiterals(text), kind, effects });
        packageOfPath.set(relativePath, name);
      }
    }
  }

  const reaches = computeReaches(modulesByPath, packageOfPath);

  const findings = [];
  const census = {};
  for (const [name] of wanted) census[name] = { modules: 0, hull: 0, kernel: 0, findings: 0, hullReachingKernel: 0 };
  for (const [path, record] of modulesByPath) {
    const packageName = packageOfPath.get(path);
    const bucket = census[packageName];
    bucket.modules += 1;
    bucket[record.kind] += 1;
    if (record.kind === "hull" && (reaches.get(path) ?? 0) >= 2) bucket.hullReachingKernel += 1;
  }

  for (const [path, record] of modulesByPath) {
    if (record.kind !== "hull") continue;
    for (const match of record.strippedText.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
      const resolved = resolveRelativeModule(specifier, path, modulesByPath);
      if (resolved === undefined) continue;
      const target = modulesByPath.get(resolved);
      if (target.kind !== "kernel") continue;
      const packageName = packageOfPath.get(path);
      findings.push({ package: packageName, importer: path, imported: resolved, effects: target.effects, kind: "hull-imports-kernel" });
      census[packageName].findings += 1;
    }
  }

  for (const [name, directory] of wanted) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8")); } catch { continue; }
    const entryFile = packageEntryFile(manifest, join(root, directory));
    if (entryFile === undefined) continue;
    const entryPath = `${directory}/${entryFile}`.replace(/\/{2,}/gu, "/");
    let entryRecord = modulesByPath.get(entryPath);
    if (entryRecord === undefined) {
      let text;
      try { text = readFileSync(join(root, entryPath), "utf8"); } catch { continue; }
      entryRecord = classifyModule(text);
      entryRecord = { ...entryRecord, text };
    }
    if (entryRecord.kind !== "kernel") continue;
    const packageHullPaths = [...modulesByPath].filter(([path, record]) => packageOfPath.get(path) === name && record.kind === "hull").map(([path]) => path);
    if (packageHullPaths.length === 0) continue;
    const reachable = reachableFrom([entryPath], modulesByPath);
    const stranded = packageHullPaths.filter((path) => !reachable.has(path));
    if (stranded.length === 0) continue;
    findings.push({ package: name, kind: "entry-is-kernel", entry: entryPath, entryEffects: entryRecord.effects, strandedHullModules: stranded.sort() });
    census[name].findings += 1;
  }

  const modules = [...modulesByPath.keys()].sort().map((path) => {
    const record = modulesByPath.get(path);
    const reach = reaches.get(path);
    return { path, package: packageOfPath.get(path), kind: record.kind, effects: record.effects, ...(reach === undefined ? {} : { reaches: reach }) };
  });

  return { findings, census, modules };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const root = resolve(argument("--root", args) || process.cwd());
  const map = discoverHousePackages(root);
  const packageDirectory = argument("--package", args);
  const report = auditHullKernel({ root, map, packageDirectory });
  process.stdout.write(`${JSON.stringify(args.includes("--summary") ? { findings: report.findings.length, census: report.census } : report, null, 2)}\n`);
}
