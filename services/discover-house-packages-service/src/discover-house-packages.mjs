import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const PRUNE = new Set(["node_modules", ".git", "dist", "legacy", ".tmp", ".cache", "coverage", ".wrangler"]);

function* manifestsUnder(directory) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!PRUNE.has(entry.name)) yield* manifestsUnder(path);
    } else if (entry.name === "package.json") yield path;
  }
}

/** The package map of `{ directory, text }` manifests: a name owned twice goes to its non-legacy, shallowest directory. */
function housePackagesOf(root, manifests) {
  const packages = {};
  const duplicates = {};
  const rank = (path) => [path.includes("/legacy/") ? 1 : 0, path.split("/").length];
  for (const { directory, text } of manifests) {
    let name;
    try { name = JSON.parse(text).name; } catch { continue; }
    if (typeof name !== "string" || !name.startsWith("@")) continue;
    if (!(name in packages)) { packages[name] = directory; continue; }
    const [keptLegacy, keptDepth] = rank(packages[name]);
    const [candidateLegacy, candidateDepth] = rank(directory);
    if (candidateLegacy < keptLegacy || (candidateLegacy === keptLegacy && candidateDepth < keptDepth)) {
      (duplicates[name] ??= []).push(packages[name]);
      packages[name] = directory;
    } else (duplicates[name] ??= []).push(directory);
  }
  return { root, packages, duplicates };
}

/** Discover package ownership from the manifests that actually exist; no registry is maintained. */
export function discoverHousePackages(root) {
  root = resolve(root);
  return housePackagesOf(root, (function* () {
    for (const manifestPath of manifestsUnder(root)) {
      let text;
      try { text = readFileSync(manifestPath, "utf8"); } catch { continue; }
      yield { directory: relative(root, dirname(manifestPath)), text };
    }
  })());
}
