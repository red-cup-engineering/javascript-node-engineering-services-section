import { existsSync, globSync, statSync } from "node:fs";
import { isAbsolute, matchesGlob, relative, resolve, sep } from "node:path";

// This source check rejects definite exclusions by an explicit files whitelist.
// Native packing still receives ignore rules and the installed file contents.
function publicationAllows(root, manifest, file) {
  if (!Array.isArray(manifest.files)) return true;
  const automatic = ["package.json", manifest.main, ...(typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {}))];
  if (automatic.some(path => typeof path === "string" && resolve(root, path) === file)) return true;
  const path = relative(root, file).split(sep).join("/");
  if (!path.includes("/") && /^(?:readme|licen[cs]e|copying)(?:\.|$)/iu.test(path)) return true;
  const patterns = manifest.files.filter(pattern => typeof pattern === "string" && !pattern.startsWith("!"))
    .map(pattern => pattern.replace(/^\.\//u, "").replace(/\/+$/u, ""));
  if (!patterns.length && manifest.files.length) return true;
  const parts = path.split("/"), ancestors = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  return patterns.some(pattern => pattern === "." || ancestors.some(path => matchesGlob(path, pattern)));
}

function targets(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(targets);
  if (value === null || typeof value !== "object") return [];
  const keys = Object.keys(value);
  if (keys.some(key => key.startsWith("."))) return keys.flatMap(key => targets(value[key]));
  // Node's ESM conditions use the first matching branch in declaration order.
  const key = keys.find(key => ["node", "import", "default"].includes(key));
  return key === undefined ? [] : targets(value[key]);
}
/** Actual published ESM/bin/main entrances, with missing carriers kept explicit. */
export function declaredNodeRuntimeEntries(root, manifest) {
  const entries = [], missing = [], unpacked = [];
  const paths = [...targets(manifest.exports), ...(typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {}))];
  if (!manifest.exports && manifest.main) paths.push(manifest.main);
  for (const path of new Set(paths)) {
    const absolute = resolve(root, path), offset = relative(root, absolute);
    if (isAbsolute(offset) || offset === ".." || offset.startsWith("../")) throw new TypeError("package carrier escapes its owner: " + manifest.name);
    const files = path.includes("*") ? globSync(path, { cwd: root }).map(file => resolve(root, file)) : [absolute];
    if (!files.length) missing.push({ path: absolute, declaration: path, reason: "unmatched-export" });
    for (const file of files) {
      if (existsSync(file) && statSync(file).isDirectory()) continue;
      if (!publicationAllows(root, manifest, file)) unpacked.push({ path: file, declaration: path, reason: "published-carrier-excluded-by-files" });
      if (!existsSync(file)) missing.push({ path: file, declaration: path, reason: "absent-carrier" });
      else if (/\.(?:[cm]?js|tsx?)$/u.test(file) && !/\.d\.[cm]?ts$/u.test(file)) entries.push(file);
    }
  }
  return { entries, missing, unpacked };
}
