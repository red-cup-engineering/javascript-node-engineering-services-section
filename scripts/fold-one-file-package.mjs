#!/usr/bin/env node
// Folds a one-file package (exactly one .mjs/.cjs source under src/, scripts/ or apps/) into the
// scripts/ of its section, the nearest ancestor directory with a package.json. The source moves to
// <section>/scripts/<basename>, its test/**/*.test.mjs files to <section>/test/, and any data/
// files the source's text names to <section>/data/records/ (a basename collision is resolved with
// <package-stem>-<basename>, the directory name minus a trailing -service or -services-section);
// any other file the moving text names by basename (a sibling the source opens via a bare
// `new URL("./x", import.meta.url)`, a test fixture reached by a constructed path — nothing
// `rewriteMovedSpecifiers` already catches) moves alongside it, its own top directory remapped the
// same way (src/scripts/apps -> scripts, test -> test) so a same-directory reference keeps resolving.
// relative imports inside the moved files are re-relativized, a target that no longer exists is
// reported rather than guessed, then the package directory is deleted whole. Every importer under
// lib (node_modules and /legacy/ excluded) is rewritten: bare "@scope/<package-name>[/<sub>]"
// becomes "@scope/<section-name>/<basename-without-extension>", relative imports into the deleted
// package are re-relativized to the moved file, the package leaves the importer's dependencies and
// the section joins them only when the manifest already lists dependencies. The section's exports
// gain "./<basename-without-extension>": "./scripts/<basename>" (the form filepath-services-section
// uses), created flat when the section had no exports at all.
//
//   node fold-one-file-package.mjs --package <directory> [--dry-run] [--root /home/emsenn/info]
//
// Prints a JSON report: moved (old -> new), deleted, rewritten importers, manifest changes, and a
// refusal reason when the directory is not a one-file package. Refusals make no changes.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

const DEFAULT_ROOT = "/home/emsenn/info";
const SOURCE_DIRS = ["src", "scripts", "apps"];
const EMBEDDED_PROJECT_FILES = new Set(["lakefile.toml", "Cargo.toml", "pyproject.toml"]);
const EXT_CANDIDATES = [".mjs", ".cjs"];
const SPECIFIER_PATTERN = /((?:\bfrom\s*|\bimport\s*\(?\s*|\bimport\s+|\brequire\s*\()["'])([^"']+)(["'])/gu;
const IMPORTER_EXTENSIONS = new Set([".mjs", ".cjs", ".js", ".mts", ".cts", ".ts"]);
const COMPANION_TOP_REMAP = { src: "scripts", scripts: "scripts", apps: "scripts", test: "test" };
const COMPANION_IGNORED_BASENAMES = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "README.md", "DESIGN.md"]);
const COMPANION_TEXT_EXTENSIONS = new Set([".mjs", ".cjs"]);

function* walk(directory, skip) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path, skip);
    else if (entry.isFile()) yield path;
  }
}

function toPosix(path) {
  return path.split(sep).join("/");
}

/** The directory name minus a trailing -services-section or -service, used to disambiguate a collision. */
export function packageStem(directoryName) {
  return directoryName.replace(/-services-section$/u, "").replace(/-service$/u, "");
}

/** The basename with its .mjs/.cjs extension removed, used for the exports key and bare specifier. */
export function withoutExtension(name) {
  return name.replace(/\.(?:mjs|cjs)$/u, "");
}

/** The package's own name with its npm scope and a trailing -services-section or -service stripped. */
export function boringPackageName(name) {
  const local = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  return packageStem(local);
}

/**
 * Inspects a candidate package directory for the one-file shape: exactly one .mjs/.cjs source under
 * src/, scripts/ or apps/ (a nested services/ directory, an embedded project, or TypeScript sources
 * each refuse first, in that order). Returns `{ ok: true, source }` or `{ ok: false, reason }`.
 */
export function inspectOneFilePackage(packageDir) {
  const skip = new Set(["node_modules", ".git"]);
  let hasNestedServices = false;
  let embeddedProject;
  const jsSources = [];
  const tsSources = [];
  for (const path of walk(packageDir, skip)) {
    const tail = relative(packageDir, path);
    const segments = tail.split(sep);
    if (segments.includes("services")) { hasNestedServices = true; continue; }
    if (embeddedProject === undefined && EMBEDDED_PROJECT_FILES.has(basename(path))) embeddedProject = tail;
    if (!SOURCE_DIRS.includes(segments[0])) continue;
    const name = basename(path);
    if (/\.d\.(?:mts|cts|ts)$/u.test(name)) continue;
    if (/\.(?:mts|cts|ts)$/u.test(name)) tsSources.push(tail);
    else if (/\.(?:mjs|cjs)$/u.test(name)) jsSources.push(tail);
  }
  if (hasNestedServices) return { ok: false, reason: "a nested services/ directory" };
  if (embeddedProject !== undefined) return { ok: false, reason: `an embedded project (${embeddedProject})` };
  if (tsSources.length > 0) return { ok: false, reason: `TypeScript source(s): ${tsSources.join(", ")}` };
  if (jsSources.length !== 1) return { ok: false, reason: `expected exactly one source file under src/, scripts/ or apps/, found ${jsSources.length}${jsSources.length > 0 ? ` (${jsSources.join(", ")})` : ""}` };
  return { ok: true, source: join(packageDir, jsSources[0]) };
}

/**
 * The nearest ancestor of `packageDir`, strictly between it and `root`, that has a package.json,
 * read for its name and version. `root` itself is never accepted as a section: it is the
 * workspace's own anchor manifest, not a section that scripts fold into.
 */
export function findSection(packageDir, root) {
  let directory = dirname(resolve(packageDir));
  const stop = resolve(root);
  while (directory !== stop && directory !== dirname(directory)) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name === "string") return { dir: directory, name: manifest.name, version: manifest.version };
    }
    directory = dirname(directory);
  }
  return undefined;
}

/** Every test/*_/*.test.mjs (recursive) file under a package. */
export function collectTestFiles(packageDir) {
  const testRoot = join(packageDir, "test");
  if (!existsSync(testRoot)) return [];
  return [...walk(testRoot, new Set(["node_modules", ".git"]))].filter((path) => path.endsWith(".test.mjs"));
}

/** Every file under a package's data/ directory. */
export function collectDataFiles(packageDir) {
  const dataRoot = join(packageDir, "data");
  if (!existsSync(dataRoot)) return [];
  return [...walk(dataRoot, new Set(["node_modules", ".git"]))];
}

/**
 * Files elsewhere in the package that are neither the source, a collected test, under data/, nor
 * package bookkeeping (package.json, lockfiles, README, DESIGN.md): a sibling script the source reaches
 * through a bare `new URL("./x", import.meta.url)`, or a test fixture reached by a constructed path,
 * rather than a `from`/`import`/`require` specifier `rewriteMovedSpecifiers` would already catch. A file
 * sitting directly at the package root (not under any subdirectory, like a stray top-level config) is
 * left out: nothing about its right destination is implied the way a subdirectory's name implies one.
 */
export function collectCompanionFiles(packageDir, { sourcePath, testPaths }) {
  const skip = new Set(["node_modules", ".git"]);
  const excluded = new Set([sourcePath, ...testPaths]);
  const files = [];
  for (const path of walk(packageDir, skip)) {
    if (excluded.has(path)) continue;
    if (COMPANION_IGNORED_BASENAMES.has(basename(path))) continue;
    const segments = relative(packageDir, path).split(sep);
    if (segments.length < 2) continue;
    if (segments[0] === "data") continue;
    files.push(path);
  }
  return files;
}

/**
 * Where a companion file lands: its path relative to the package with the top directory remapped
 * (src/scripts/apps -> scripts, test -> test, else kept), resolved for a basename collision the same
 * way a moved source, test or data file is.
 */
export function resolveCompanionDestination(sectionDir, packageDir, companionPath, stem, taken) {
  const segments = relative(packageDir, companionPath).split(sep);
  const top = COMPANION_TOP_REMAP[segments[0]] ?? segments[0];
  const subdir = [top, ...segments.slice(1, -1)].join(sep);
  return resolveDestination(sectionDir, subdir, segments[segments.length - 1], stem, taken);
}

/**
 * Plans the destination for a moved file: `<sectionDir>/<subdir>/<basename>`, or the package-stem
 * prefixed form when that path is already taken on disk or already claimed by this fold.
 */
export function resolveDestination(sectionDir, subdir, name, stem, taken) {
  const plain = join(sectionDir, subdir, name);
  const target = !existsSync(plain) && !taken.has(plain) ? plain : join(sectionDir, subdir, `${stem}-${name}`);
  taken.add(target);
  return target;
}

/** Resolves a relative specifier from `fromDir` against real files on disk, trying the .mjs/.cjs and index conventions. */
export function resolveRelativeSource(fromDir, specifier) {
  const base = resolve(fromDir, specifier);
  if (existsSync(base) && statSync(base).isFile()) return base;
  if (extname(base) === "") {
    for (const ext of EXT_CANDIDATES) if (existsSync(base + ext)) return base + ext;
    for (const ext of EXT_CANDIDATES) { const index = join(base, `index${ext}`); if (existsSync(index)) return index; }
  }
  return undefined;
}

/**
 * Rewrites the relative specifiers of a file that is itself moving from `oldDir` to `newDir`:
 * `relocations` (absolute old path -> absolute new path) covers the other files moving in the same
 * fold. A specifier resolving inside `packageDir` but outside `relocations` is about to be deleted;
 * it is reported in `unresolved` and left unchanged rather than guessed.
 */
export function rewriteMovedSpecifiers(text, { oldDir, newDir, packageDir, relocations }) {
  const unresolved = [];
  const rewritten = text.replace(SPECIFIER_PATTERN, (whole, prefix, specifier, suffix) => {
    if (!specifier.startsWith(".")) return whole;
    const target = resolveRelativeSource(oldDir, specifier);
    let mapped;
    if (target === undefined) { unresolved.push(specifier); return whole; }
    if (relocations.has(target)) mapped = relocations.get(target);
    else if (!target.startsWith(packageDir + sep)) mapped = target;
    else { unresolved.push(specifier); return whole; }
    let rel = toPosix(relative(newDir, mapped));
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `${prefix}${rel}${suffix}`;
  });
  return { text: rewritten, unresolved };
}

/**
 * Rewrites one importer file's specifiers: a bare specifier naming the folded package (with any
 * subpath) becomes `newSpecifier`; a relative specifier resolving into `packageDir` is re-relativized
 * to `newSourcePath`. Returns the rewritten text and the specifiers actually changed.
 */
export function rewriteImporterSpecifiers(text, importerDir, { oldName, newSpecifier, packageDir, sourcePath, newSourcePath }) {
  const changed = [];
  const rewritten = text.replace(SPECIFIER_PATTERN, (whole, prefix, specifier, suffix) => {
    let next;
    if (!specifier.startsWith(".")) {
      if (specifier === oldName || specifier.startsWith(`${oldName}/`)) next = newSpecifier;
    } else {
      const guess = resolve(importerDir, specifier);
      const candidates = extname(guess) === "" ? [guess, `${guess}.mjs`, `${guess}.cjs`] : [guess];
      if (candidates.some((candidate) => candidate === sourcePath || candidate.startsWith(packageDir + sep))) {
        let rel = toPosix(relative(importerDir, newSourcePath));
        if (!rel.startsWith(".")) rel = `./${rel}`;
        next = rel;
      }
    }
    if (next === undefined || next === specifier) return whole;
    changed.push({ from: specifier, to: next });
    return `${prefix}${next}${suffix}`;
  });
  return { text: rewritten, changed };
}

function manifestEntry(manifests, manifestPath) {
  if (!manifests.has(manifestPath)) manifests.set(manifestPath, { json: JSON.parse(readFileSync(manifestPath, "utf8")), changes: [] });
  return manifests.get(manifestPath);
}

/** Folds the one-file package at `packageDir`; with dryRun nothing is written or deleted. */
export function foldOneFilePackage({ packageDir, root = DEFAULT_ROOT, dryRun = false }) {
  const absoluteRoot = resolve(root);
  const absolutePackage = resolve(packageDir);
  const report = { package: toPosix(relative(absoluteRoot, absolutePackage)), dryRun, refused: null, section: null, moved: [], deleted: [], rewrittenImporters: [], manifestChanges: [], unresolvedImports: [] };
  const manifestPath = join(absolutePackage, "package.json");
  if (!existsSync(manifestPath)) { report.refused = "no package.json"; return report; }
  const packageManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof packageManifest.name !== "string") { report.refused = "package.json has no name"; return report; }
  const inspection = inspectOneFilePackage(absolutePackage);
  if (!inspection.ok) { report.refused = inspection.reason; return report; }
  const section = findSection(absolutePackage, absoluteRoot);
  if (section === undefined) { report.refused = "no ancestor package.json (section) found"; return report; }
  report.section = toPosix(relative(absoluteRoot, section.dir));

  const oldName = packageManifest.name;
  const sourcePath = inspection.source;
  const directoryName = basename(absolutePackage);
  const stem = packageStem(directoryName);
  const taken = new Set();

  // A source named index.mjs/index.cjs says nothing about the package once it's just one file among a
  // section's scripts; it takes the package's own boring name instead (its own -services-section is
  // named after the section it lands in, an index.mjs sitting in it stays anonymous otherwise).
  const sourceBasename = withoutExtension(basename(sourcePath)) === "index"
    ? `${boringPackageName(oldName)}${extname(sourcePath)}`
    : basename(sourcePath);
  const sourceDestination = resolveDestination(section.dir, "scripts", sourceBasename, stem, taken);
  const relocations = new Map([[sourcePath, sourceDestination]]);
  const testMoves = collectTestFiles(absolutePackage).map((path) => ({ from: path, to: resolveDestination(section.dir, "test", basename(path), stem, taken) }));
  for (const move of testMoves) relocations.set(move.from, move.to);

  const sourceText = readFileSync(sourcePath, "utf8");
  const testTexts = new Map(testMoves.map((move) => [move.from, readFileSync(move.from, "utf8")]));
  const dataMoves = [];
  for (const path of collectDataFiles(absolutePackage)) {
    if (!sourceText.includes(basename(path))) continue;
    const destination = resolveDestination(section.dir, join("data", "records"), basename(path), stem, taken);
    dataMoves.push({ from: path, to: destination });
    relocations.set(path, destination);
  }

  // Companion files: reached by the source or a test through something other than a from/import/require
  // specifier (a bare new URL(..., import.meta.url), a constructed path), so rewriteMovedSpecifiers never
  // sees them. Named in the text that moves, they move with it rather than being silently deleted.
  const referenceTexts = [sourceText, ...testTexts.values()];
  const companionMoves = [];
  for (const path of collectCompanionFiles(absolutePackage, { sourcePath, testPaths: testMoves.map((move) => move.from) })) {
    if (!referenceTexts.some((text) => text.includes(basename(path)))) continue;
    const destination = resolveCompanionDestination(section.dir, absolutePackage, path, stem, taken);
    companionMoves.push({ from: path, to: destination });
    relocations.set(path, destination);
  }

  const newBasename = basename(sourceDestination);
  const exportsKey = `./${withoutExtension(newBasename)}`;
  const newSpecifier = `${section.name}/${withoutExtension(newBasename)}`;

  const writes = [];
  const copies = [...dataMoves];
  const { text: rewrittenSource, unresolved: sourceUnresolved } = rewriteMovedSpecifiers(sourceText, { oldDir: dirname(sourcePath), newDir: dirname(sourceDestination), packageDir: absolutePackage, relocations });
  writes.push({ path: sourceDestination, text: rewrittenSource });
  for (const specifier of sourceUnresolved) report.unresolvedImports.push({ file: toPosix(relative(absoluteRoot, sourcePath)), specifier });
  report.moved.push({ from: toPosix(relative(absoluteRoot, sourcePath)), to: toPosix(relative(absoluteRoot, sourceDestination)) });

  for (const move of testMoves) {
    const text = testTexts.get(move.from);
    const { text: rewrittenTest, unresolved } = rewriteMovedSpecifiers(text, { oldDir: dirname(move.from), newDir: dirname(move.to), packageDir: absolutePackage, relocations });
    writes.push({ path: move.to, text: rewrittenTest });
    for (const specifier of unresolved) report.unresolvedImports.push({ file: toPosix(relative(absoluteRoot, move.from)), specifier });
    report.moved.push({ from: toPosix(relative(absoluteRoot, move.from)), to: toPosix(relative(absoluteRoot, move.to)) });
  }

  for (const move of companionMoves) {
    if (COMPANION_TEXT_EXTENSIONS.has(extname(move.from))) {
      const text = readFileSync(move.from, "utf8");
      const { text: rewrittenCompanion, unresolved } = rewriteMovedSpecifiers(text, { oldDir: dirname(move.from), newDir: dirname(move.to), packageDir: absolutePackage, relocations });
      writes.push({ path: move.to, text: rewrittenCompanion });
      for (const specifier of unresolved) report.unresolvedImports.push({ file: toPosix(relative(absoluteRoot, move.from)), specifier });
    } else {
      copies.push(move);
    }
    report.moved.push({ from: toPosix(relative(absoluteRoot, move.from)), to: toPosix(relative(absoluteRoot, move.to)) });
  }

  for (const move of dataMoves) {
    report.moved.push({ from: toPosix(relative(absoluteRoot, move.from)), to: toPosix(relative(absoluteRoot, move.to)) });
  }

  const manifests = new Map();
  const sectionManifestPath = join(section.dir, "package.json");
  const sectionEntry = manifestEntry(manifests, sectionManifestPath);
  if (sectionEntry.json.exports === undefined) sectionEntry.json.exports = {};
  if (sectionEntry.json.exports[exportsKey] !== `./scripts/${newBasename}`) {
    sectionEntry.json.exports[exportsKey] = `./scripts/${newBasename}`;
    sectionEntry.changes.push(`exports["${exportsKey}"]`);
  }

  // Importers: every file under lib (node_modules and legacy pruned) that names the folded package,
  // by bare specifier or by a relative path resolving inside it.
  const importerSkip = new Set(["node_modules", ".git", "legacy"]);
  for (const path of walk(join(absoluteRoot, "lib"), importerSkip)) {
    if (!IMPORTER_EXTENSIONS.has(extname(path))) continue;
    if (path === sourcePath || path.startsWith(absolutePackage + sep)) continue;
    const text = readFileSync(path, "utf8");
    if (!text.includes(oldName) && !text.includes(directoryName)) continue;
    const importerDir = dirname(path);
    const { text: rewritten, changed } = rewriteImporterSpecifiers(text, importerDir, { oldName, newSpecifier, packageDir: absolutePackage, sourcePath, newSourcePath: sourceDestination });
    if (changed.length === 0) continue;
    writes.push({ path, text: rewritten });
    report.rewrittenImporters.push({ file: toPosix(relative(absoluteRoot, path)), specifiers: changed });

    let directory = importerDir;
    let ownManifestPath;
    while (true) {
      const candidate = join(directory, "package.json");
      if (existsSync(candidate)) { ownManifestPath = candidate; break; }
      if (directory === absoluteRoot || directory === dirname(directory)) break;
      directory = dirname(directory);
    }
    if (ownManifestPath === undefined) continue;
    const entry = manifestEntry(manifests, ownManifestPath);
    if (entry.json.dependencies && oldName in entry.json.dependencies) { delete entry.json.dependencies[oldName]; entry.changes.push(`dependencies.${oldName} removed`); }
    if (ownManifestPath !== sectionManifestPath && entry.json.dependencies && !(section.name in entry.json.dependencies)) {
      entry.json.dependencies[section.name] = section.version ?? "*";
      entry.changes.push(`dependencies["${section.name}"] added`);
    }
  }

  for (const [path, entry] of manifests) if (entry.changes.length > 0) report.manifestChanges.push({ file: toPosix(relative(absoluteRoot, path)), changes: entry.changes });

  report.deleted.push(toPosix(relative(absoluteRoot, absolutePackage)));

  if (!dryRun) {
    for (const write of writes) { mkdirSync(dirname(write.path), { recursive: true }); writeFileSync(write.path, write.text); }
    for (const move of copies) { mkdirSync(dirname(move.to), { recursive: true }); copyFileSync(move.from, move.to); }
    rmSync(absolutePackage, { recursive: true, force: true });
    for (const [path, entry] of manifests) if (entry.changes.length > 0) writeFileSync(path, `${JSON.stringify(entry.json, null, 2)}\n`);
  }

  return report;
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--package");
  if (at < 0 || !args[at + 1]) { process.stderr.write("usage: fold-one-file-package --package <directory> [--dry-run] [--root /home/emsenn/info]\n"); process.exit(2); }
  const rootAt = args.indexOf("--root");
  const root = rootAt < 0 || !args[rootAt + 1] ? DEFAULT_ROOT : args[rootAt + 1];
  const report = foldOneFilePackage({ packageDir: args[at + 1], root, dryRun: args.includes("--dry-run") });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
