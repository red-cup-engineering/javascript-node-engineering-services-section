#!/usr/bin/env node
// The layer audit as a ratchet: a candidate commit may remove layer findings, never add one. Both
// commits are read from git objects (see git-tree-at-ref), submodules at their gitlinks, so the
// verdict is the commits' and no working tree's. A finding counts by what it is, not where its file
// sits: the layer edge it crosses and the specifier it imports. A file moved to another directory or
// package of the same layer keeps its findings' keys; a new inversion, or another import of an
// inverted specifier, raises a key's count and is refused.
//
// Only the files a candidate changes can change its findings while the layer record stands and no
// package moves, so those are all that is read. When the candidate changes the record, or seats a
// package name at another directory, every audited source is read at both commits.
//
//   node ratchet-layer-imports.mjs --base <ref> --candidate <ref> [--root <repository>] [--summary]
//
// Prints the verdict as JSON; exits 1 when the candidate is refused.
import { resolve } from "node:path";
import { isAuditedSource, layerEdgeOf, layerFindingsOfSource } from "./audit-layer-imports.mjs";
import { argument } from "../src/argv.mjs";
import { discoverHousePackagesInTree } from "../src/discover-house-packages.mjs";
import { compareTallies, reseated, tallyFindings } from "../src/finding-ratchet.mjs";
import { changedPaths, gitTreeAtRef } from "../src/git-tree-at-ref.mjs";

export const LAYERS_SUFFIX = "javascript-node-services-section/data/records/house-layers.json";

/** The house layer record a tree holds, with its path and text. */
function layerRecordIn(tree) {
  const paths = [...tree.blobs.keys()].filter((path) => path.endsWith(`/${LAYERS_SUFFIX}`));
  if (paths.length !== 1) throw new Error(`${tree.ref}: expected one ${LAYERS_SUFFIX}, found ${paths.length}`);
  const text = tree.read(paths).get(paths[0]).toString("utf8");
  return { path: paths[0], text, layers: JSON.parse(text) };
}

/** A finding's ratchet key: across which edge, what is imported. Where the importer sits is attribution. */
const KEY_FIELDS = Object.freeze(["edge", "specifier"]);

/** The names a candidate gave packages whose directory held another name at the base. A rename is
 *  neither a removed nor an added finding: renaming communicating-in-english out of a personal scope
 *  read as one inversion removed and one added, and the gate refused it (2026-10-04). */
export function renamedPackages(baseMap, candidateMap) {
  const nameAt = new Map(Object.entries(baseMap.packages).map(([name, directory]) => [directory, name]));
  return new Map(Object.entries(candidateMap.packages)
    .filter(([name, directory]) => baseMap.packages[name] === undefined && nameAt.has(directory) && nameAt.get(directory) !== name)
    .map(([name, directory]) => [name, nameAt.get(directory)]));
}

/** A specifier read under the base's names: a renamed package's specifier keys as its old name. */
export function underBaseNames(specifier, renamed) {
  for (const [name, before] of renamed) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return `${before}${specifier.slice(name.length)}`;
  }
  return specifier;
}

function tallyAt(tree, paths, record, map, renamed = new Map()) {
  const findings = [...tree.read(paths)].flatMap(([path, buffer]) => layerFindingsOfSource(path, buffer.toString("utf8"), record.layers, map));
  return tallyFindings(findings, (finding) => `${layerEdgeOf(finding)}\t${underBaseNames(finding.specifier, renamed)}`);
}

/** The ratchet verdict of `candidate` against `base` in the repository at `root`. */
export function ratchetLayerImports({ root, base, candidate }) {
  return ratchetLayerImportsOfTrees(gitTreeAtRef(root, base), gitTreeAtRef(root, candidate));
}

/** The ratchet verdict between two tree views of one repository (see git-tree-at-ref). */
export function ratchetLayerImportsOfTrees(before, after) {
  const baseRecord = layerRecordIn(before);
  const candidateRecord = layerRecordIn(after);
  const baseMap = discoverHousePackagesInTree(before);
  const candidateMap = discoverHousePackagesInTree(after);
  const full = baseRecord.text !== candidateRecord.text || reseated(baseMap, candidateMap);
  const audited = (tree, record) => (path) => path.startsWith(`${record.layers.root}/`) && isAuditedSource(path) && tree.blobs.has(path);
  const changed = full ? undefined : changedPaths(before, after);
  const basePaths = (changed ?? [...before.blobs.keys()]).filter(audited(before, baseRecord));
  const candidatePaths = (changed ?? [...after.blobs.keys()]).filter(audited(after, candidateRecord));
  const { rose, fell } = compareTallies(tallyAt(before, basePaths, baseRecord, baseMap), tallyAt(after, candidatePaths, candidateRecord, candidateMap, renamedPackages(baseMap, candidateMap)), KEY_FIELDS);
  const unreadable = after.unreadable.filter((link) => !before.unreadable.some((other) => other.path === link.path && other.commit === link.commit));
  const reasons = [
    ...rose.map((row) => `layer-finding-added:${row.edge}:${row.specifier}:${row.base}->${row.candidate}`),
    ...unreadable.map((link) => `submodule-unreadable:${link.path}@${link.commit}`),
  ];
  return Object.freeze({
    kind: "house-layers:ratchet",
    base: before.commit,
    candidate: after.commit,
    layers: Object.freeze({ base: baseRecord.layers.version, candidate: candidateRecord.layers.version }),
    mode: full ? "full" : "changed",
    audited: Object.freeze({ base: basePaths.length, candidate: candidatePaths.length }),
    added: rose.reduce((sum, row) => sum + row.candidate - row.base, 0),
    removed: fell.reduce((sum, row) => sum + row.base - row.candidate, 0),
    rose: Object.freeze(rose),
    fell: Object.freeze(fell),
    admitted: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const base = argument("--base", args);
  const candidate = argument("--candidate", args);
  if (base === undefined || candidate === undefined) {
    process.stderr.write("usage: ratchet-layer-imports --base <ref> --candidate <ref> [--root <repository>] [--summary]\n");
    process.exit(64);
  }
  const verdict = ratchetLayerImports({ root: resolve(argument("--root", args) ?? process.cwd()), base, candidate });
  const { rose, fell, ...summary } = verdict;
  process.stdout.write(`${JSON.stringify(args.includes("--summary") ? summary : verdict, null, 2)}\n`);
  process.exitCode = verdict.admitted ? 0 : 1;
}
