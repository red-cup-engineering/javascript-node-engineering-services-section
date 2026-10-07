#!/usr/bin/env node
// Translates one package's TypeScript sources to plain Node modules with Node's own type
// stripping (node:module stripTypeScriptTypes; no external tool), rewrites the specifiers that
// pointed at TypeScript or compiled twins, deletes the TypeScript sources, declarations, dist,
// tsconfig and build info, and repoints package.json at the translated sources.
//
//   node translate-typescript-package.mjs --package <directory> [--dry-run]
//
// Prints a JSON report: translated files with the stripping mode used, deleted paths, and the
// package.json fields rewritten. Nested packages (a services/ directory), node_modules and .git
// are never entered.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const SKIP = new Set(["node_modules", ".git", "services", "dist", "coverage", ".tmp", ".cache"]);
const SOURCE_EXTENSIONS = new Map([[".mts", ".mjs"], [".cts", ".cjs"], [".ts", ".mjs"]]);
const SPECIFIER_PATTERN = /((?:\bfrom\s*|\bimport\s*\(?\s*|\bimport\s+)["'])([^"']+)(["'])/gu;

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/** The translated sibling for a TypeScript source path, or undefined when the path is not one. */
export function translatedPath(path) {
  if (/\.d\.(mts|cts|ts)$/u.test(path)) return undefined;
  const extension = extname(path);
  const target = SOURCE_EXTENSIONS.get(extension);
  return target === undefined ? undefined : path.slice(0, -extension.length) + target;
}

/**
 * Removes what type stripping leaves in place of erased annotations. The position-preserving
 * mode replaces every erased character with a space, so with the source alongside each run of
 * spaces is read against it: a run holding erased characters keeps at most one of the source's
 * own edge spaces, none before a closing token, and none of the source spaces that sat between
 * erased characters; a comma left dangling before a closing brace by an erased type specifier
 * goes with it; then trailing spaces and runs of blank lines go.
 * @param {string} stripped Output of stripTypeScriptTypes.
 * @param {string} [source] The TypeScript it came from, when the output preserves positions.
 */
export function tidyStripped(stripped, source) {
  let text = stripped;
  if (source !== undefined && source.length === stripped.length) {
    const kept = [];
    const isSpace = (character) => character === " " || character === "\t";
    let index = 0;
    while (index < stripped.length) {
      if (!isSpace(stripped[index])) { kept.push(stripped[index]); index += 1; continue; }
      let stop = index;
      while (stop < stripped.length && isSpace(stripped[stop])) stop += 1;
      const run = source.slice(index, stop);
      if (!/\S/u.test(run)) { kept.push(stripped.slice(index, stop)); index = stop; continue; }
      const next = stripped[stop] ?? "";
      if (next === "}" && kept[kept.length - 1] === ",") { kept.pop(); kept.push(" "); index = stop; continue; }
      const closing = /[,;)\]]/u.test(next);
      if (!closing && (/^\s/u.test(run) || /\s$/u.test(run))) kept.push(" ");
      index = stop;
    }
    text = kept.join("");
  }
  return text.replace(/[ \t]+$/gmu, "").replace(/\n{3,}/gu, "\n\n");
}

/** Strips types, preferring the comment-preserving mode and falling back when the syntax is not erasable, then tidies. */
export function stripSource(source) {
  try { return { text: tidyStripped(stripTypeScriptTypes(source, { mode: "strip" }), source), mode: "strip" }; }
  catch { return { text: tidyStripped(stripTypeScriptTypes(source, { mode: "transform", sourceMap: false })), mode: "transform" }; }
}

/**
 * Rewrites the relative specifiers of one translated module: `.mts`/`.ts`/`.cts` endings, the
 * compiled `.js` twin of a translated sibling, and extensionless paths to translated siblings.
 * @param {string} text Translated module text.
 * @param {string} fromDirectory Directory of the module.
 * @param {Set<string>} translated Absolute paths of every translated output module.
 */
export function rewriteSpecifiers(text, fromDirectory, translated) {
  return text.replace(SPECIFIER_PATTERN, (whole, prefix, specifier, suffix) => {
    if (!specifier.startsWith(".")) return whole;
    const absolute = resolve(fromDirectory, specifier);
    const extension = extname(absolute);
    const candidates = [];
    if (SOURCE_EXTENSIONS.has(extension)) candidates.push(absolute.slice(0, -extension.length) + SOURCE_EXTENSIONS.get(extension));
    if (extension === ".js") candidates.push(`${absolute.slice(0, -3)}.mjs`);
    if (extension === "" || !SOURCE_EXTENSIONS.has(extension) && extension !== ".js") for (const target of [".mjs", ".cjs"]) candidates.push(absolute + target, join(absolute, `index${target}`));
    const found = candidates.find((candidate) => translated.has(candidate));
    if (found === undefined) return whole;
    let rewritten = relative(fromDirectory, found).split("\\").join("/");
    if (!rewritten.startsWith(".")) rewritten = `./${rewritten}`;
    return `${prefix}${rewritten}${suffix}`;
  });
}

/** Repoints a package.json value from a TypeScript source or compiled dist path at the translated source. */
export function repointManifestPath(value, root, translated) {
  if (typeof value !== "string" || !value.startsWith("./")) return value;
  const stripped = value.replace(/^\.\/dist\//u, "./");
  const attempts = [stripped, stripped.replace(/\.js$/u, ".mjs"), stripped.replace(/\.(mts|ts)$/u, ".mjs"), stripped.replace(/\.cts$/u, ".cjs"), `./src/${stripped.slice(2)}`.replace(/\.js$/u, ".mjs")];
  const found = attempts.find((attempt) => translated.has(resolve(root, attempt)) || existsSync(resolve(root, attempt)) && !/\.(mts|cts|ts)$/u.test(attempt) && attempt !== value);
  return found ?? value;
}

function repointExports(exports, root, translated) {
  if (typeof exports === "string") return repointManifestPath(exports, root, translated);
  if (Array.isArray(exports)) return exports.map((entry) => repointExports(entry, root, translated));
  if (exports && typeof exports === "object") {
    const out = {};
    for (const [key, value] of Object.entries(exports)) if (key !== "types") out[key] = repointExports(value, root, translated);
    return out;
  }
  return exports;
}

/** Translates the package at `root`; with dryRun nothing is written or deleted. */
export function translateTypescriptPackage({ root, dryRun = false }) {
  const packageRoot = resolve(root);
  const manifestPath = join(packageRoot, "package.json");
  if (!existsSync(manifestPath)) throw new Error(`no package.json at ${packageRoot}`);
  const sources = [...walk(packageRoot)].filter((path) => translatedPath(path) !== undefined);
  const translated = new Set(sources.map(translatedPath));
  const outputs = [];
  for (const source of sources) {
    const target = translatedPath(source);
    const { text, mode } = stripSource(readFileSync(source, "utf8"));
    const rewritten = rewriteSpecifiers(text, dirname(source), translated);
    outputs.push({ source: relative(packageRoot, source), target: relative(packageRoot, target), mode });
    if (!dryRun) { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, rewritten); }
  }
  const deleted = [];
  for (const path of sources) deleted.push(relative(packageRoot, path));
  for (const path of walk(packageRoot)) if (/\.d\.(mts|cts|ts)(\.map)?$/u.test(path) || /\.tsbuildinfo$/u.test(path) || /^tsconfig.*\.json$/u.test(basename(path))) deleted.push(relative(packageRoot, path));
  if (existsSync(join(packageRoot, "dist"))) deleted.push("dist");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const changes = [];
  for (const field of ["main", "module", "bin", "browser"]) {
    if (typeof manifest[field] === "string") { const next = repointManifestPath(manifest[field], packageRoot, translated); if (next !== manifest[field]) { manifest[field] = next; changes.push(field); } }
    else if (manifest[field] && typeof manifest[field] === "object") { for (const key of Object.keys(manifest[field])) { const next = repointManifestPath(manifest[field][key], packageRoot, translated); if (next !== manifest[field][key]) { manifest[field][key] = next; changes.push(`${field}.${key}`); } } }
  }
  if (manifest.exports !== undefined) { const next = repointExports(manifest.exports, packageRoot, translated); if (JSON.stringify(next) !== JSON.stringify(manifest.exports)) { manifest.exports = next; changes.push("exports"); } }
  for (const field of ["types", "typings"]) if (field in manifest) { delete manifest[field]; changes.push(field); }
  if (Array.isArray(manifest.files) && manifest.files.includes("dist")) { manifest.files = manifest.files.map((entry) => (entry === "dist" ? "src" : entry)); changes.push("files"); }
  for (const dependencyField of ["devDependencies", "dependencies", "peerDependencies"]) {
    const block = manifest[dependencyField];
    if (!block) continue;
    for (const name of Object.keys(block)) if (/^(typescript|ts-node|tsx|@types\/)/u.test(name)) { delete block[name]; changes.push(`${dependencyField}.${name}`); }
    if (Object.keys(block).length === 0) delete manifest[dependencyField];
  }
  if (manifest.scripts) {
    for (const [name, command] of Object.entries(manifest.scripts)) {
      if (/\btsc\b|\bts-node\b|\btsx\b/u.test(command)) {
        if (name === "test") { manifest.scripts.test = "node --test \"**/*.test.mjs\""; changes.push("scripts.test"); }
        else { delete manifest.scripts[name]; changes.push(`scripts.${name}`); }
      } else if (/\.(mts|cts|ts)\b/u.test(command)) {
        manifest.scripts[name] = command.replace(/\.mts\b/gu, ".mjs").replace(/\.cts\b/gu, ".cjs").replace(/\.ts\b/gu, ".mjs");
        changes.push(`scripts.${name}`);
      }
    }
  }
  if (!dryRun) {
    for (const path of deleted) rmSync(join(packageRoot, path), { recursive: true, force: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { package: packageRoot, dryRun, translated: outputs, deleted, manifestChanges: changes };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--package");
  if (at < 0 || !args[at + 1]) { process.stderr.write("usage: translate-typescript-package --package <directory> [--dry-run]\n"); process.exit(2); }
  const report = translateTypescriptPackage({ root: args[at + 1], dryRun: args.includes("--dry-run") });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
