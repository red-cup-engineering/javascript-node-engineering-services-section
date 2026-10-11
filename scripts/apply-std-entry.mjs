#!/usr/bin/env node
/**
 * Apply STD-ENTRY across repositories: rewrite every hand-written entry guard (a comparison of
 * `process.argv[1]` with `import.meta.url`) to `isEntryModule(import.meta.url)` from
 * `@red-cup-engineering/node-process-services-section/entrypoint`, add that dependency to each package it
 * touches, and audit what starts running: a guard that was symlink-blind did nothing when its script was run
 * through a `node_modules` link, and runs once rewritten.
 *
 *   apply-std-entry.mjs [--check | --write] [--exclude GLOB ...] [--include-legacy] [--hold PACKAGE_GLOB ...] [--callers DIR ...] ROOT ...
 *
 * `--check` (the default) changes nothing and exits 1 when a guard is left to rewrite. `--write` rewrites in
 * place. Each ROOT is walked through `git ls-files` when it is a repository (otherwise by directory, past
 * node_modules and .git). `--callers DIR` names machine snapshots, deployments and repositories searched for
 * invocations of each script whose behaviour changes. `--hold` leaves every package whose name matches untouched
 * (reported under `held`) until its callers are decided. One JSON report goes to stdout.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { isEntryModule } from "@red-cup-engineering/node-process-services-section/entrypoint";
import { rewriteEntryGuards, STD_ENTRY_OWNER } from "../src/std-entry.mjs";

const SOURCE = /\.(?:mjs|js)$/u;
const OWNER_FILE = "node-process-services-section/src/entrypoint.mjs";
const DEFAULT_EXCLUDE = ["**/legacy/**", "**/node_modules/**"];
const TEXT = /\.(?:mjs|js|cjs|json|scm|sh|service|timer|ya?ml|conf|md)$/u;

function filesUnder(root, wanted) {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (listed.status === 0) return listed.stdout.split("\0").filter((file) => file && wanted.test(file)).map((file) => join(root, file));
  const found = [];
  const visit = (directory) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.isSymbolicLink()) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && wanted.test(entry.name)) found.push(full);
    }
  };
  visit(root);
  return found;
}

const toPosix = (file) => file.split(sep).join("/");

/** The nearest package.json at or above `file`, no higher than `root`. */
function owningPackage(file, root) {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) return { directory, manifest, json: JSON.parse(readFileSync(manifest, "utf8")) };
    if (directory === root || dirname(directory) === directory) return undefined;
  }
}

/** The bin names and export subpaths through which a package publishes `packagePath`. */
function publishedAs(json, packagePath) {
  const same = (target) => typeof target === "string" && posix.normalize(target) === posix.normalize(`./${packagePath}`);
  const bins = typeof json.bin === "string" ? (same(json.bin) ? [json.name?.split("/").pop()] : [])
    : Object.entries(json.bin ?? {}).filter(([, target]) => same(target)).map(([name]) => name);
  const exported = Object.entries(typeof json.exports === "object" && json.exports !== null ? json.exports : {})
    .filter(([, target]) => same(target) || (typeof target === "object" && target !== null && Object.values(target).some(same))).map(([subpath]) => subpath);
  return { bins, exported };
}

/** Lines in the caller roots that invoke `packagePath` or one of its bins. */
function callersOf(callerFiles, packageName, packageDirectory, packagePath, bins) {
  // Qualified by its package (as installed under node_modules, as composed under packages/, or as its source
  // directory), so one package's src/server.mjs is not taken for another's.
  const needles = [
    ...(packageName ? [`${packageName}/${packagePath}`, `${packageName.replace("/", "__")}/${packagePath}`] : []),
    `${packageDirectory}/${packagePath}`,
    ...bins.map((bin) => `.bin/${bin}`),
  ];
  const hits = [];
  for (const { root, file, text } of callerFiles) {
    if (!needles.some((needle) => text.includes(needle))) continue;
    text.split("\n").forEach((line, index) => {
      if (needles.some((needle) => line.includes(needle))) hits.push({ file: toPosix(relative(root, file)), root, line: index + 1, text: line.trim().slice(0, 240), throughNodeModules: line.includes("node_modules/") });
    });
  }
  return hits;
}

export function applyStdEntry(roots, { write = false, exclude = DEFAULT_EXCLUDE, hold = [], callers = [] } = {}) {
  const report = { kind: "std-entry-report.v1", mode: write ? "write" : "check", roots, files: [], dependencies: [], audit: [], held: [], unrewritten: [], unparsed: [], excluded: [] };
  const callerFiles = callers.flatMap((root) => filesUnder(resolve(root), TEXT).flatMap((file) => {
    try { return statSync(file).size > 4 * 1024 * 1024 ? [] : [{ root, file, text: readFileSync(file, "utf8") }]; } catch { return []; }
  }));
  const manifests = new Map();
  for (const given of roots) {
    const root = resolve(given);
    for (const file of filesUnder(root, SOURCE)) {
      const path = toPosix(relative(root, file));
      if (path.endsWith(OWNER_FILE)) continue;
      let text;
      try { text = readFileSync(file, "utf8"); } catch { continue; }
      if (!text.includes("process.argv[1]")) continue;
      if (exclude.some((glob) => posix.matchesGlob(path, glob))) { report.excluded.push({ root: given, path }); continue; }
      let result;
      try { result = rewriteEntryGuards(text); }
      catch (error) { report.unparsed.push({ root: given, path, error: error instanceof Error ? error.message : String(error) }); continue; }
      for (const item of result.unrewritten) report.unrewritten.push({ root: given, path, ...item });
      if (!result.changed) continue;
      const pkg = owningPackage(file, root);
      const packagePath = pkg ? toPosix(relative(pkg.directory, file)) : path;
      if (pkg?.json.name && hold.some((glob) => posix.matchesGlob(pkg.json.name, glob))) {
        report.held.push({ root: given, path, package: pkg.json.name, rewrites: result.rewrites.length, symlinkBlind: result.rewrites.some((rewrite) => rewrite.symlinkBlind) });
        continue;
      }
      report.files.push({ root: given, path, package: pkg?.json.name ?? null, rewrites: result.rewrites, imports: result.imports });
      if (write) writeFileSync(file, result.text);
      if (pkg && pkg.json.name !== STD_ENTRY_OWNER) {
        if (!manifests.has(pkg.manifest)) manifests.set(pkg.manifest, readFileSync(pkg.manifest, "utf8"));
      }
      if (result.rewrites.some((rewrite) => rewrite.symlinkBlind)) {
        const { bins, exported } = pkg ? publishedAs(pkg.json, packagePath) : { bins: [], exported: [] };
        report.audit.push({ root: given, path, package: pkg?.json.name ?? null, packagePath, bins, exported,
          change: "symlink-blind guard: run through a node_modules link it did nothing and exited 0; once rewritten it runs",
          callers: callersOf(callerFiles, pkg?.json.name, pkg ? pkg.directory.split(sep).pop() : "", packagePath, bins) });
      }
    }
  }
  for (const [manifest, text] of manifests) {
    const json = JSON.parse(text);
    const declared = json.dependencies?.[STD_ENTRY_OWNER] ?? json.peerDependencies?.[STD_ENTRY_OWNER];
    report.dependencies.push({ package: json.name, manifest: toPosix(relative(process.cwd(), manifest)), added: declared === undefined, spec: declared ?? "workspace:*" });
    if (!write || declared !== undefined) continue;
    json.dependencies = Object.fromEntries(Object.entries({ ...(json.dependencies ?? {}), [STD_ENTRY_OWNER]: "workspace:*" }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const indent = /^\{\n([ \t]+)"/u.exec(text)?.[1] ?? "  ";
    writeFileSync(manifest, `${JSON.stringify(json, null, indent)}\n`);
  }
  const rewrites = report.files.flatMap((file) => file.rewrites);
  report.summary = { files: report.files.length, guards: rewrites.length, symlinkBlind: rewrites.filter((rewrite) => rewrite.symlinkBlind).length,
    dependenciesAdded: report.dependencies.filter((entry) => entry.added).length, held: report.held.length, unrewritten: report.unrewritten.length, unparsed: report.unparsed.length,
    callersThroughNodeModules: report.audit.flatMap((entry) => entry.callers).filter((hit) => hit.throughNodeModules).length };
  return report;
}

if (isEntryModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = { write: false, exclude: [...DEFAULT_EXCLUDE], hold: [], callers: [] };
  const roots = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--write") options.write = true;
    else if (args[i] === "--check") options.write = false;
    else if (args[i] === "--include-legacy") options.exclude = options.exclude.filter((glob) => glob !== "**/legacy/**");
    else if (args[i] === "--exclude") options.exclude.push(args[++i]);
    else if (args[i] === "--callers") options.callers.push(args[++i]);
    else if (args[i] === "--hold") options.hold.push(args[++i]);
    else roots.push(args[i]);
  }
  if (roots.length === 0) { process.stderr.write("usage: apply-std-entry.mjs [--check | --write] [--exclude GLOB ...] [--include-legacy] [--hold PACKAGE_GLOB ...] [--callers DIR ...] ROOT ...\n"); process.exit(2); }
  const report = applyStdEntry(roots, options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!options.write && report.summary.guards > 0) process.exitCode = 1;
}
