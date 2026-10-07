/**
 * Node module-resolution hook: a house-scoped specifier resolves to its
 * in-tree source directory through the projected package map, honouring that
 * package's `exports`. Every other specifier passes through unchanged. One
 * codebase, no node_modules for house code.
 *
 * Registered by `scripts/register-house-resolver.mjs` (`node --import`).
 */
import { readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverHousePackages } from "./discover-house-packages.mjs";

export const HOUSE_SCOPES = Object.freeze(["@red-cup-engineering/", "@lenticule-science/", "@561-group/", "@emsenn/", "@causeway-services/", "@coesite-operations/"]);

let root = null;
let packages = null;
const manifests = new Map();

export function initialize({ root: repositoryRoot = process.cwd() } = {}) {
  const discovered = discoverHousePackages(repositoryRoot);
  root = discovered.root;
  packages = discovered.packages;
}

/** `@scope/name/sub/path` → [`@scope/name`, `./sub/path`]; bare package → `.` */
export function splitHouseSpecifier(specifier) {
  const slash = specifier.indexOf("/", specifier.indexOf("/") + 1);
  return slash < 0 ? [specifier, "."] : [specifier.slice(0, slash), `.${specifier.slice(slash)}`];
}

const CONDITIONS = ["node", "import", "module", "default"];

function target(entry) {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) { for (const item of entry) { const found = target(item); if (found) return found; } return undefined; }
  if (entry && typeof entry === "object") { for (const condition of CONDITIONS) if (condition in entry) { const found = target(entry[condition]); if (found) return found; } }
  return undefined;
}

/** Resolve a subpath through a package's `exports`, as Node does for exact and `*` keys. */
export function resolveExports(exports, subpath) {
  if (exports === undefined || exports === null) return undefined;
  if (typeof exports === "string" || Array.isArray(exports)) return subpath === "." ? target(exports) : undefined;
  const keys = Object.keys(exports);
  if (!keys.some((key) => key.startsWith("."))) return subpath === "." ? target(exports) : undefined;
  if (subpath in exports) return target(exports[subpath]);
  for (const key of keys) {
    const star = key.indexOf("*");
    if (star < 0) continue;
    const head = key.slice(0, star), tail = key.slice(star + 1);
    if (subpath.startsWith(head) && subpath.endsWith(tail) && subpath.length >= key.length - 1) {
      const found = target(exports[key]);
      return found === undefined ? undefined : found.replace("*", subpath.slice(head.length, subpath.length - tail.length));
    }
  }
  return undefined;
}

function manifest(directory) {
  if (!manifests.has(directory)) manifests.set(directory, JSON.parse(readFileSync(join(directory, "package.json"), "utf8")));
  return manifests.get(directory);
}

export async function resolve(specifier, context, next) {
  if (packages === null || !HOUSE_SCOPES.some((scope) => specifier.startsWith(scope))) return next(specifier, context);
  const [name, subpath] = splitHouseSpecifier(specifier);
  const relative = packages[name];
  if (relative === undefined) return next(specifier, context);
  const directory = resolvePath(root, relative);
  const pkg = manifest(directory);
  let file = resolveExports(pkg.exports, subpath);
  if (file === undefined && subpath === ".") file = pkg.module ?? pkg.main ?? "./index.mjs";
  if (file === undefined) file = subpath;
  return { url: pathToFileURL(join(directory, file)).href, shortCircuit: true };
}
