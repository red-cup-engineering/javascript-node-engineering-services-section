#!/usr/bin/env node
/**
 * Project the house package map: every package.json under the repository's
 * lib tree (node_modules, dist, .git and .tmp pruned) keyed by package name to
 * its repository-relative directory. A name held by several directories keeps
 * the shallowest non-legacy one and lists the rest under `duplicates`, so the
 * ambiguity is data rather than a silent choice.
 *
 * usage: node project-house-package-map.mjs [--root /home/emsenn/info] [--out <file>]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname, resolve as resolvePath } from "node:path";
import { argument } from "../src/argv.mjs";

const PRUNE = new Set(["node_modules", ".git", "dist", ".tmp", ".cache", "coverage"]);

function* manifestsUnder(directory) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { if (!PRUNE.has(entry.name)) yield* manifestsUnder(join(directory, entry.name)); }
    else if (entry.name === "package.json") yield join(directory, entry.name);
  }
}

export function projectHousePackageMap({ root }) {
  const packages = {}, duplicates = {};
  const rank = (path) => [path.includes("/legacy/") ? 1 : 0, path.split("/").length];
  for (const manifestPath of manifestsUnder(join(root, "lib"))) {
    let name;
    try { name = JSON.parse(readFileSync(manifestPath, "utf8")).name; } catch { continue; }
    if (typeof name !== "string" || !name.startsWith("@")) continue;
    const directory = relative(root, dirname(manifestPath));
    if (!(name in packages)) { packages[name] = directory; continue; }
    const [keptLegacy, keptDepth] = rank(packages[name]), [legacy, depth] = rank(directory);
    if (legacy < keptLegacy || (legacy === keptLegacy && depth < keptDepth)) { (duplicates[name] ??= []).push(packages[name]); packages[name] = directory; }
    else (duplicates[name] ??= []).push(directory);
  }
  const sorted = Object.fromEntries(Object.keys(packages).sort().map((key) => [key, packages[key]]));
  return { root, generatedAt: new Date().toISOString(), count: Object.keys(sorted).length, packages: sorted, duplicates };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""))) {
  const args = process.argv.slice(2);
  const root = resolvePath(argument("--root", args) ?? resolvePath(new URL(".", import.meta.url).pathname, "../../../../../../../../../../../../../../"));
  const out = argument("--out", args) ?? new URL("../data/records/house-package-map.json", import.meta.url).pathname;
  const map = projectHousePackageMap({ root });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(map, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ out, count: map.count, duplicates: Object.keys(map.duplicates).length, root })}\n`);
}
