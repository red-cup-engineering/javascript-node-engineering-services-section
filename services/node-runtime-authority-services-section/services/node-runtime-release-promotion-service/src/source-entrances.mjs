import { existsSync, globSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

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
  const entries = [], missing = [];
  const paths = [...targets(manifest.exports), ...(typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {}))];
  if (!manifest.exports && manifest.main) paths.push(manifest.main);
  for (const path of new Set(paths)) {
    const absolute = resolve(root, path), offset = relative(root, absolute);
    if (isAbsolute(offset) || offset === ".." || offset.startsWith("../")) throw new TypeError("package carrier escapes its owner: " + manifest.name);
    const files = path.includes("*") ? globSync(path, { cwd: root }).map(file => resolve(root, file)) : [absolute];
    if (!files.length) missing.push({ path: absolute, declaration: path, reason: "unmatched-export" });
    for (const file of files) {
      if (!existsSync(file)) missing.push({ path: file, declaration: path, reason: "absent-carrier" });
      else if (/\.(?:[cm]?js|tsx?)$/u.test(file) && !/\.d\.[cm]?ts$/u.test(file)) entries.push(file);
    }
  }
  return { entries, missing };
}
