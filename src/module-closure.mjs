/**
 * The code a computation runs, as one identity: the modules its entries import, followed through
 * relative paths and workspace packages, each named by its package and path within it and digested
 * with its bytes. A dependency installed from a registry is named by its version and not entered.
 *
 * The identity is independent of where the tree sits, so a cache keyed by it survives a release
 * moving the same code to a new directory, and is invalidated by any change to code it reaches.
 * Static imports, re-exports and literal dynamic imports are followed; a computed `import()` is not.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { builtinModules, findPackageJSON } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseJavaScript, walkJavaScript } from "./javascript-parser.mjs";

const BUILTIN = new Set(builtinModules);
const CONDITIONS = ["node", "import", "default"];

function packageOf(file) {
  const manifest = findPackageJSON(pathToFileURL(file));
  return { root: dirname(manifest), manifest: JSON.parse(readFileSync(manifest, "utf8")) };
}

function condition(target) {
  if (target === null || typeof target === "string") return target;
  if (Array.isArray(target)) return target.map(condition).find((value) => value != null) ?? null;
  for (const name of CONDITIONS) if (name in target) {
    const chosen = condition(target[name]);
    if (chosen != null) return chosen;
  }
  return null;
}

function exported(manifest, subpath) {
  const { exports } = manifest;
  if (exports === undefined) return subpath === "." ? manifest.main ?? "index.js" : subpath;
  const map = typeof exports === "string" || Array.isArray(exports) || !Object.keys(exports).some((key) => key.startsWith("."))
    ? { ".": exports }
    : exports;
  if (subpath in map) return condition(map[subpath]);
  for (const [pattern, target] of Object.entries(map)) {
    const star = pattern.indexOf("*");
    if (star < 0 || !subpath.startsWith(pattern.slice(0, star)) || !subpath.endsWith(pattern.slice(star + 1))) continue;
    const match = subpath.slice(star, subpath.length - (pattern.length - star - 1));
    return condition(target)?.replaceAll("*", match) ?? null;
  }
  return null;
}

function packageDirectory(name, from) {
  for (let directory = dirname(from); ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(directory) === directory) return null;
  }
}

function resolveSpecifier(specifier, from) {
  if (specifier.startsWith("node:") || BUILTIN.has(specifier.split("/")[0])) return null;
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const file = resolve(dirname(from), specifier);
    if (!existsSync(file)) return { external: `unresolved:${relative(packageOf(from).root, file)}` };
    return { file: statSync(file).isDirectory() ? join(file, "index.js") : file };
  }
  if (specifier.startsWith("file:")) return { file: fileURLToPath(specifier) };
  if (specifier.startsWith("#")) {
    const { root, manifest } = packageOf(from);
    const target = exported({ exports: manifest.imports ?? {} }, specifier);
    if (target === null) return { external: `unresolved:${specifier}` };
    return target.startsWith(".") ? { file: resolve(root, target) } : resolveSpecifier(target, join(root, "package.json"));
  }
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  // A package may import itself by its own name.
  const own = packageOf(from);
  const directory = own.manifest.name === name && own.manifest.exports !== undefined ? own.root : packageDirectory(name, from);
  if (directory === null) return { external: `unresolved:${specifier}` };
  const root = realpathSync(directory);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (root.split(sep).includes("node_modules")) return { external: `${manifest.name}@${manifest.version}` };
  const target = exported(manifest, specifier === name ? "." : `./${specifier.slice(name.length + 1)}`);
  return target === null ? { external: `unexported:${specifier}` } : { file: resolve(root, target) };
}

function importsOf(file, text) {
  if (!/\.[cm]?js$/u.test(file)) return [];
  let program;
  // Source the parser refuses is still digested; it is a leaf of the graph.
  try { program = parseJavaScript(text, { sourceType: "module" }); } catch { return []; }
  const specifiers = [];
  walkJavaScript(program, (node) => {
    if (node.type === "ImportDeclaration" || ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source)
      || (node.type === "ImportExpression" && node.source?.type === "Literal")) {
      if (typeof node.source.value === "string") specifiers.push(node.source.value);
    }
  });
  return specifiers;
}

/**
 * The digest of the module graph reached from `entries` (paths or file URLs), with the number of
 * modules it covers and the registry packages it stops at.
 */
export function moduleClosureDigest(entries) {
  const pending = entries.map((entry) => realpathSync(entry instanceof URL || String(entry).startsWith("file:") ? fileURLToPath(entry) : entry));
  const modules = new Map();
  const external = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (modules.has(file)) continue;
    const bytes = readFileSync(file);
    const { root, manifest } = packageOf(file);
    modules.set(file, `${manifest.name ?? relative(dirname(root), root)}/${relative(root, file).split(sep).join("/")}\0${createHash("sha256").update(bytes).digest("hex")}`);
    for (const specifier of importsOf(file, bytes.toString("utf8"))) {
      const resolved = resolveSpecifier(specifier, file);
      if (resolved?.external) external.add(resolved.external);
      else if (resolved) pending.push(realpathSync(resolved.file));
    }
  }
  const hash = createHash("sha256");
  for (const line of [...modules.values()].sort()) hash.update(`${line}\n`);
  for (const name of [...external].sort()) hash.update(`${name}\n`);
  return { digest: hash.digest("hex"), modules: modules.size, external: [...external].sort() };
}
